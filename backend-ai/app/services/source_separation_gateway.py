"""FastAPI service entrypoint for engine-neutral source separation."""
from __future__ import annotations

import asyncio
import tempfile
import time
import wave
from pathlib import Path

from app.core.config import settings
from app.core.logging_config import get_internal_logger
from app.schemas.source_separation import (
    NegotiatedProfile,
    OutputSummary,
    QualityStatistics,
    SeparationManifest,
    SeparationStatistics,
    SourceSeparationRequest,
    Stem,
    profile_roles,
)
from app.services.separation.registry import SeparationEngineRegistry
from app.services.separation.storage import SeparationStorage

_log = get_internal_logger("source_separation")


class SeparationAdmissionError(RuntimeError):
    """Raised before engine execution when a configured safety budget is exceeded."""


class SeparationCapacityError(SeparationAdmissionError):
    """Raised instead of keeping an unbounded in-process GPU queue."""


class SeparationExecutionTimeoutError(TimeoutError):
    """Raised when one full separation attempt exceeds its wall-clock budget."""


class SourceSeparationGateway:
    def __init__(
        self,
        registry: SeparationEngineRegistry,
        storage: SeparationStorage,
        *,
        engine_id: str = settings.separation_engine_id,
        max_input_bytes: int = settings.separation_max_input_bytes,
        max_input_duration_ms: int = settings.separation_max_input_duration_ms,
        max_output_size_multiplier: int = settings.separation_max_output_size_multiplier,
        execution_timeout_seconds: float = settings.separation_execution_timeout_seconds,
        max_concurrent_jobs: int = settings.separation_max_concurrent_jobs,
    ) -> None:
        if max_concurrent_jobs < 1:
            raise ValueError("max_concurrent_jobs must be at least one")
        self._registry = registry
        self._storage = storage
        self._engine_id = engine_id
        self._max_input_bytes = max_input_bytes
        self._max_input_duration_ms = max_input_duration_ms
        self._max_output_size_multiplier = max_output_size_multiplier
        self._execution_timeout_seconds = execution_timeout_seconds
        self._admission = asyncio.BoundedSemaphore(max_concurrent_jobs)

    async def separate(self, request: SourceSeparationRequest) -> SeparationManifest:
        if self._admission.locked():
            _log.warning(
                "source separation rejected: capacity exhausted",
                extra={"engine": self._engine_id, "profile": request.profile.value},
            )
            raise SeparationCapacityError("source separation capacity is exhausted")

        started = time.perf_counter()
        async with self._admission:
            try:
                return await asyncio.wait_for(
                    self._separate_within_budget(request, started),
                    timeout=self._execution_timeout_seconds,
                )
            except asyncio.TimeoutError as exc:
                raise SeparationExecutionTimeoutError("source separation attempt timed out") from exc

    async def _separate_within_budget(
        self,
        request: SourceSeparationRequest,
        started: float,
    ) -> SeparationManifest:
        uploaded_refs: list[str] = []
        try:
            return await self._execute_separation(request, started, uploaded_refs)
        except BaseException:
            await self._cleanup_uploaded_objects(uploaded_refs)
            raise

    async def _execute_separation(
        self,
        request: SourceSeparationRequest,
        started: float,
        uploaded_refs: list[str],
    ) -> SeparationManifest:
        engine = self._registry.get(self._engine_id, request.profile)
        download_started = time.perf_counter()
        download_ms = 0
        engine_ms = 0
        upload_ms = 0
        with tempfile.TemporaryDirectory(prefix="source-separation-") as temp_dir_value:
            temp_dir = Path(temp_dir_value)
            source_path = temp_dir / "source.wav"
            output_dir = temp_dir / "outputs"
            await asyncio.to_thread(self._storage.download, request.source_audio_ref, source_path)
            download_ms = round((time.perf_counter() - download_started) * 1000)
            input_bytes = source_path.stat().st_size
            input_duration_ms = _wav_duration_ms(source_path)
            self._validate_input_budget(input_bytes, input_duration_ms)
            engine_started = time.perf_counter()
            result = await engine.separate(
                source_path,
                output_dir,
                profile=request.profile,
                model_id=settings.separation_model_id,
            )
            engine_ms = round((time.perf_counter() - engine_started) * 1000)

            output_bytes = sum(stem.path.stat().st_size for stem in result.stems)
            if output_bytes > input_bytes * self._max_output_size_multiplier:
                raise SeparationAdmissionError("separation output exceeds the configured size budget")

            upload_started = time.perf_counter()
            stems: list[Stem] = []
            for engine_stem in result.stems:
                object_key = f"separation/{request.run_id}/{engine_stem.role.value.lower()}"
                stored = await asyncio.to_thread(
                    self._storage.upload,
                    engine_stem.path,
                    object_key,
                    content_type=engine_stem.mime_type,
                )
                uploaded_refs.append(stored.object_ref)
                stems.append(
                    Stem(
                        role=engine_stem.role,
                        objectRef=stored.object_ref,
                        durationMs=engine_stem.duration_ms,
                        mimeType=engine_stem.mime_type,
                        codec=engine_stem.codec,
                        channels=engine_stem.channels,
                        sampleRateHz=engine_stem.sample_rate_hz,
                        fileSizeBytes=stored.file_size_bytes,
                        checksumSha256=stored.checksum_sha256,
                    )
                )
            upload_ms = round((time.perf_counter() - upload_started) * 1000)

        manifest_started = time.perf_counter()
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        required_roles, optional_roles = profile_roles(request.profile)
        roles = [stem.role for stem in stems]
        manifest = SeparationManifest(
            manifestVersion=1,
            runId=request.run_id,
            engine={
                "engineId": engine.engine_id,
                "engineVersion": result.engine_version,
                "modelId": result.model_id,
            },
            profile=NegotiatedProfile(
                id=request.profile,
                requiredRoles=list(required_roles),
                optionalRoles=list(optional_roles),
            ),
            stems=stems,
            warnings=[],
            outputSummary=OutputSummary(roles=roles, stemCount=len(stems)),
            statistics=SeparationStatistics(
                executionTimeMs=elapsed_ms,
                inputDurationMs=result.input_duration_ms,
                producedStemCount=len(stems),
                quality=QualityStatistics(),
                perStemQuality=[],
            ),
        )
        validated = SeparationManifest.model_validate(
            manifest.model_dump(by_alias=True, mode="json")
        )
        manifest_ms = round((time.perf_counter() - manifest_started) * 1000)
        _log.info(
            "source separation completed",
            extra={
                "manifestVersion": validated.manifest_version,
                "runId": request.run_id,
                "engine": engine.engine_id,
                "durationMs": input_duration_ms,
                "executionTimeMs": elapsed_ms,
                "downloadTimeMs": download_ms,
                "engineTimeMs": engine_ms,
                "uploadTimeMs": upload_ms,
                "manifestGenerationTimeMs": manifest_ms,
                "model": result.model_id,
                "profile": request.profile.value,
                "inputBytes": input_bytes,
                "outputBytes": output_bytes,
                "stemCount": len(stems),
            },
        )
        return validated

    async def _cleanup_uploaded_objects(self, object_refs: list[str]) -> None:
        if not object_refs:
            return
        failures = 0
        for object_ref in object_refs:
            try:
                await asyncio.to_thread(self._storage.delete, object_ref)
            except Exception:
                failures += 1
        if failures:
            _log.warning(
                "source separation orphan cleanup incomplete",
                extra={"objectCount": len(object_refs), "failedDeleteCount": failures},
            )

    def _validate_input_budget(self, input_bytes: int, input_duration_ms: int) -> None:
        if input_bytes <= 0 or input_duration_ms <= 0:
            raise SeparationAdmissionError("source audio must contain media data")
        if input_bytes > self._max_input_bytes:
            raise SeparationAdmissionError("source audio exceeds the configured size budget")
        if input_duration_ms > self._max_input_duration_ms:
            raise SeparationAdmissionError("source audio exceeds the configured duration budget")


def _wav_duration_ms(path: Path) -> int:
    """Inspect the CT7.1 WAV handoff without adding an audio runtime dependency."""
    try:
        with wave.open(str(path), "rb") as wav:
            sample_rate = wav.getframerate()
            if sample_rate <= 0:
                raise SeparationAdmissionError("source audio has an invalid sample rate")
            return round(wav.getnframes() * 1000 / sample_rate)
    except (OSError, wave.Error) as exc:
        raise SeparationAdmissionError("source audio must be a readable WAV artifact") from exc
