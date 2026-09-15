from __future__ import annotations

import asyncio
import io
import wave
from pathlib import Path

import pytest

from app.schemas.source_separation import AudioRole, SeparationProfileId, SourceSeparationRequest
from app.services.separation.base import EngineResult, EngineStem, SeparationEngine
from app.services.separation.registry import SeparationEngineRegistry
from app.services.separation.storage import InMemorySeparationStorage
from app.services.source_separation_gateway import (
    SeparationAdmissionError,
    SeparationCapacityError,
    SeparationExecutionTimeoutError,
    SourceSeparationGateway,
)


def wav_bytes(duration_seconds: int = 1) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b"\x00\x00" * 2 * 8000 * duration_seconds)
    return buffer.getvalue()


class BlockingSeparationEngine(SeparationEngine):
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    @property
    def engine_id(self) -> str:
        return "local_demucs"

    @property
    def supported_profiles(self) -> frozenset[SeparationProfileId]:
        return frozenset({SeparationProfileId.VOCAL_MUSIC})

    async def separate(self, source_path: Path, output_dir: Path, *, profile, model_id):
        self.started.set()
        await self.release.wait()
        raise AssertionError("released blocking engine should not finish in this test")


class MockSeparationEngine(SeparationEngine):
    @property
    def engine_id(self) -> str:
        return "local_demucs"

    @property
    def supported_profiles(self) -> frozenset[SeparationProfileId]:
        return frozenset({SeparationProfileId.VOCAL_MUSIC})

    async def separate(self, source_path: Path, output_dir: Path, *, profile, model_id):
        assert source_path.read_bytes() == wav_bytes()
        output_dir.mkdir(parents=True)
        stems = []
        for role in (AudioRole.VOCAL, AudioRole.MUSIC):
            path = output_dir / f"adapter-local-{role.value}.wav"
            path.write_bytes(role.value.encode())
            stems.append(EngineStem(role, path, 1200, "audio/wav", "pcm_s16le", 2, 44100))
        return EngineResult("demucs-test", model_id, 1200, tuple(stems))


class FailingSecondUploadStorage(InMemorySeparationStorage):
    def __init__(self) -> None:
        super().__init__()
        self._upload_count = 0

    def upload(self, source: Path, object_key: str, *, content_type: str):
        self._upload_count += 1
        if self._upload_count == 2:
            raise OSError("MinIO unavailable during stem upload")
        return super().upload(source, object_key, content_type=content_type)


@pytest.mark.asyncio
async def test_gateway_downloads_separates_uploads_and_returns_valid_manifest() -> None:
    storage = InMemorySeparationStorage()
    storage.objects["input/audio.wav"] = wav_bytes()
    gateway = SourceSeparationGateway(
        SeparationEngineRegistry([MockSeparationEngine()]),
        storage,
    )

    manifest = await gateway.separate(
        SourceSeparationRequest(
            runId="run-ct7-1",
            sourceAudioRef="input/audio.wav",
            profile="VOCAL_MUSIC",
        )
    )

    payload = manifest.model_dump(by_alias=True, mode="json")
    assert payload["engine"]["engineId"] == "local_demucs"
    assert payload["outputSummary"] == {"roles": ["VOCAL", "MUSIC"], "stemCount": 2}
    assert len(storage.objects) == 3
    assert all("adapter-local" not in stem["objectRef"] for stem in payload["stems"])


@pytest.mark.asyncio
async def test_gateway_rejects_source_that_exceeds_admission_budget() -> None:
    storage = InMemorySeparationStorage()
    storage.objects["input/audio.wav"] = wav_bytes()
    gateway = SourceSeparationGateway(
        SeparationEngineRegistry([MockSeparationEngine()]),
        storage,
        max_input_bytes=1,
    )

    with pytest.raises(SeparationAdmissionError, match="size budget"):
        await gateway.separate(
            SourceSeparationRequest(
                runId="run-ct7-admission",
                sourceAudioRef="input/audio.wav",
                profile="VOCAL_MUSIC",
            )
        )

    assert set(storage.objects) == {"input/audio.wav"}


@pytest.mark.asyncio
async def test_gateway_cleans_uploaded_stems_when_later_upload_fails() -> None:
    storage = FailingSecondUploadStorage()
    storage.objects["input/audio.wav"] = wav_bytes()
    gateway = SourceSeparationGateway(
        SeparationEngineRegistry([MockSeparationEngine()]),
        storage,
    )

    with pytest.raises(OSError, match="MinIO unavailable"):
        await gateway.separate(
            SourceSeparationRequest(
                runId="run-ct7-upload-failure",
                sourceAudioRef="input/audio.wav",
                profile="VOCAL_MUSIC",
            )
        )

    assert set(storage.objects) == {"input/audio.wav"}


@pytest.mark.asyncio
async def test_gateway_rejects_concurrent_execution_without_queueing() -> None:
    storage = InMemorySeparationStorage()
    storage.objects["input/audio.wav"] = wav_bytes()
    engine = BlockingSeparationEngine()
    gateway = SourceSeparationGateway(
        SeparationEngineRegistry([engine]),
        storage,
        max_concurrent_jobs=1,
    )
    request = SourceSeparationRequest(
        runId="run-ct7-concurrency",
        sourceAudioRef="input/audio.wav",
        profile="VOCAL_MUSIC",
    )

    active = asyncio.create_task(gateway.separate(request))
    await engine.started.wait()
    try:
        with pytest.raises(SeparationCapacityError, match="capacity"):
            await gateway.separate(request)
    finally:
        active.cancel()
        with pytest.raises(asyncio.CancelledError):
            await active


@pytest.mark.asyncio
async def test_gateway_timeout_cancels_engine_and_cleans_temp(monkeypatch, tmp_path: Path) -> None:
    storage = InMemorySeparationStorage()
    storage.objects["input/audio.wav"] = wav_bytes()
    engine = BlockingSeparationEngine()
    temp_root = tmp_path / "temp-root"
    temp_root.mkdir()

    original_temporary_directory = __import__("tempfile").TemporaryDirectory

    def temporary_directory(*, prefix: str):
        return original_temporary_directory(prefix=prefix, dir=temp_root)

    monkeypatch.setattr(
        "app.services.source_separation_gateway.tempfile.TemporaryDirectory",
        temporary_directory,
    )
    gateway = SourceSeparationGateway(
        SeparationEngineRegistry([engine]),
        storage,
        execution_timeout_seconds=0.01,
    )

    with pytest.raises(SeparationExecutionTimeoutError, match="timed out"):
        await gateway.separate(
            SourceSeparationRequest(
                runId="run-ct7-timeout",
                sourceAudioRef="input/audio.wav",
                profile="VOCAL_MUSIC",
            )
        )

    assert list(temp_root.iterdir()) == []
    assert set(storage.objects) == {"input/audio.wav"}
