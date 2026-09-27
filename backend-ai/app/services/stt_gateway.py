"""Speech-to-text gateway for media pipeline (docs/13, docs/16).

Downloads audio when needed, builds a generic ``AudioInput``, and dispatches
through the protocol adapter registry. No protocol-name branching.
"""
from __future__ import annotations

import asyncio
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Sequence
from urllib.parse import urlparse

import httpx

from app.core.config import settings
from app.core.logging_config import get_internal_logger, get_provider_logger
from app.schemas.contract import (
    ProviderPayload,
    SttResponse,
    SttSegment,
    SttUsage,
    ValidateProviderResponse,
)
from app.services.protocol import AudioInput, TranscribeResult, require_adapter
from app.services.provider_errors import (
    ProviderException,
    ProviderErrorCode,
    ProviderTransport,
    ProviderValidation,
    RETRYABLE_HTTP_STATUS,
    map_http_status_to_code,
)
from app.services.transcript_sanity import (
    TranscriptSanityResult,
    TranscriptSanityValidator,
    TranscriptSanityViolation,
)

_int_log = get_internal_logger("stt_gateway")
_prov_log = get_provider_logger("stt_gateway")

_STT_CHUNK_THRESHOLD_MS = 10 * 60 * 1000
_STT_CHUNK_DURATION_MS = 6 * 60 * 1000
_STT_CHUNK_CONCURRENCY = 2
_STT_CHUNK_BOUNDARY_TOLERANCE_MS = 3_000
_STT_TAIL_RECOVERY_TRIGGER_MS = 120_000
_STT_TAIL_RECOVERY_WINDOW_MS = 120_000
# Generative ASR may compress the timestamps of a long single call; short
# chunks keep each timeline local and are offset to their real start.
_STT_FALLBACK_CHUNK_MS = 120_000
_STT_FALLBACK_MIN_MS = 150_000
# A malformed chunk (output cap on dense dialogue, timestamps past the chunk)
# gets one plain retry, then is re-transcribed as short windows.
_STT_MALFORMED_RETRIES_BEFORE_SPLIT = 1


class _CompressedTimeline(ProviderValidation):
    """A transcript whose timestamps were squeezed; retrying the same long call rarely helps."""


@dataclass(frozen=True)
class _AudioChunk:
    index: int
    start_ms: int
    end_ms: int
    path: Path

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


@dataclass(frozen=True)
class _RecoveryWindow:
    chunk_index: int
    start_ms: int
    end_ms: int
    path: Path

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


def _malformed_message(violation: TranscriptSanityViolation | None,
                       asset_duration_ms: int | None) -> str:
    """Client-safe failure message with the minimum structured diagnostics.

    Never contains provider credentials or raw transcript content.
    """
    if violation is None:
        return "STT transcript timing is invalid"
    details = []
    if asset_duration_ms is not None:
        details.append(f"assetDurationMs={asset_duration_ms}")
    if violation.max_end_ms is not None:
        details.append(f"maxEndMs={violation.max_end_ms}")
    if violation.first_invalid_index is not None:
        details.append(
            f"firstInvalidSegmentIndex={violation.first_invalid_index}"
            f" firstInvalidStartMs={violation.first_invalid_start_ms}"
            f" firstInvalidEndMs={violation.first_invalid_end_ms}"
        )
    if violation.largest_gap_ms is not None:
        details.append(
            f"largestGapMs={violation.largest_gap_ms}"
            f" gapBeforeSegmentIndex={violation.gap_before_index}"
        )
    suffix = " — " + ", ".join(details) if details else ""
    return f"STT transcript timing is invalid ({violation.reason}){suffix}"


def _log_sanity_verdict(
    verdict,
    req,
    attempt: int,
    segments,
    *,
    validation_duration_ms: int | None = None,
) -> None:
    """Structured observability event (docs/97 §19.15 §11) — identifies which
    provider/model tends to produce malformed timing. No secrets logged."""
    violation = verdict.violation
    valid_ends = [
        int(segment.end_ms)
        for segment in (segments or [])
        if isinstance(getattr(segment, "end_ms", None), int)
    ]
    max_end_ms = max(valid_ends, default=None)
    duration_ms = (
        validation_duration_ms
        if validation_duration_ms is not None
        else req.asset_duration_ms
    )
    trailing_gap_ms = (
        max(0, duration_ms - max_end_ms)
        if duration_ms is not None and max_end_ms is not None
        else None
    )
    extra = {
        "event": "STT_TRANSCRIPT_SANITY_CHECK",
        "result": verdict.result.value,
        "provider": req.provider.protocol,
        "model": req.provider.model,
        "correlationId": req.correlation_id,
        "mediaJobId": req.media_job_id,
        "assetDurationMs": duration_ms,
        "segmentCount": len(segments) if segments is not None else 0,
        "maxEndMs": (
            violation.max_end_ms
            if violation and violation.max_end_ms is not None
            else max_end_ms
        ),
        "trailingGapMs": trailing_gap_ms,
        "largestGapMs": violation.largest_gap_ms if violation else None,
        "gapBeforeSegmentIndex": violation.gap_before_index if violation else None,
        "firstInvalidSegmentIndex": violation.first_invalid_index if violation else None,
        "firstInvalidStartMs": violation.first_invalid_start_ms if violation else None,
        "firstInvalidEndMs": violation.first_invalid_end_ms if violation else None,
        "attempt": attempt,
        "failureCode": (
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED.value
            if verdict.result is TranscriptSanityResult.MALFORMED
            else None
        ),
    }
    if verdict.result is TranscriptSanityResult.MALFORMED:
        _int_log.warning(
            "STT_TRANSCRIPT_SANITY_CHECK result=MALFORMED reason=%s segments=%d maxEndMs=%s durationMs=%s",
            violation.reason if violation else None,
            extra["segmentCount"],
            extra["maxEndMs"],
            duration_ms,
            extra=extra,
        )
    elif verdict.result is TranscriptSanityResult.SUSPICIOUS:
        _int_log.warning("STT_TRANSCRIPT_SANITY_CHECK result=SUSPICIOUS", extra=extra)
    else:
        _int_log.info("STT_TRANSCRIPT_SANITY_CHECK result=VALID", extra=extra)


async def transcribe(req: "SttRequest") -> SttResponse:
    """Transcribe an audio file referenced by a presigned URL."""
    from app.schemas.contract import SttRequest  # local import for type only

    adapter = require_adapter(req.provider.protocol, capability="STT")

    if settings.mock_mode or not settings.key_is_usable(req.provider.api_key):
        return _mock_response(req)

    try:
        if (
            req.asset_duration_ms is not None
            and req.asset_duration_ms > _STT_CHUNK_THRESHOLD_MS
        ):
            result = await _transcribe_long_audio(adapter, req)
        else:
            # Build AudioInput. Prefer URL for adapters that accept remote audio
            # (e.g. DashScope). For multipart-only adapters (OpenAI Whisper),
            # download first and pass BYTES.
            audio_input = await _prepare_audio_input(adapter, req.audio_url)
            chunkable = (
                req.asset_duration_ms is not None
                and req.asset_duration_ms > _STT_FALLBACK_MIN_MS
            )
            try:
                result = await _transcribe_with_retry(
                    adapter,
                    req,
                    audio_input,
                    stop_on_compressed=chunkable,
                    malformed_retries=_STT_MALFORMED_RETRIES_BEFORE_SPLIT if chunkable else None,
                )
            except ProviderException as exc:
                if not chunkable or exc.code != ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED:
                    raise
                _int_log.warning(
                    "STT single call stayed malformed (compressed timeline or output cap); "
                    "retranscribing in %d ms chunks",
                    _STT_FALLBACK_CHUNK_MS,
                    extra={
                        "provider": req.provider.protocol,
                        "model": req.provider.model,
                        "assetDurationMs": req.asset_duration_ms,
                        "reason": exc.message,
                    },
                )
                result = await _transcribe_long_audio(
                    adapter, req, chunk_ms=_STT_FALLBACK_CHUNK_MS
                )
            if not result.segments:
                raise ProviderValidation(
                    "STT detected no speech in the audio",
                    code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
                    provider=req.provider.base_url,
                    protocol=req.provider.protocol,
                    capability="STT",
                )
        return SttResponse(
            correlation_id=req.correlation_id,
            status="COMPLETED",
            detected_lang=result.detected_lang,
            segments=result.segments,
            usage=SttUsage(
                audio_seconds=result.audio_seconds,
                provider=req.provider.protocol,
                model=req.provider.model,
            ),
        )
    except ProviderException:
        raise
    except Exception as exc:
        _int_log.exception("STT failed unexpectedly")
        raise ProviderException(
            ProviderErrorCode.PROVIDER_UNKNOWN,
            str(exc),
            provider=req.provider.base_url,
            protocol=req.provider.protocol,
            capability="STT",
        ) from exc


def _all_zero_timing(segments: Sequence[SttSegment] | None) -> bool:
    return bool(segments) and all(
        segment.start_ms == 0 and segment.end_ms == 0
        for segment in segments
    )


def _max_segment_end(segments: Sequence[SttSegment] | None) -> int | None:
    if not segments:
        return None
    return max(segment.end_ms for segment in segments)


def _has_real_timed_speech(result: TranscribeResult) -> bool:
    return bool(result.segments) and not _all_zero_timing(result.segments)


def _split_recovery_range(start_ms: int, end_ms: int) -> list[tuple[int, int]]:
    return [
        (window_start_ms, min(window_start_ms + _STT_TAIL_RECOVERY_WINDOW_MS, end_ms))
        for window_start_ms in range(start_ms, end_ms, _STT_TAIL_RECOVERY_WINDOW_MS)
    ]


def _chunk_recovery_range(
    chunk: _AudioChunk,
    result: TranscribeResult,
    *,
    has_peer_speech: bool,
) -> tuple[int, int] | None:
    """Return a local recovery range for an initial chunk result."""
    if _all_zero_timing(result.segments):
        return None
    if result.segments:
        max_end_ms = _max_segment_end(result.segments)
        if (
            max_end_ms is not None
            and chunk.duration_ms - max_end_ms >= _STT_TAIL_RECOVERY_TRIGGER_MS
        ):
            return max_end_ms, chunk.duration_ms
        return None
    if chunk.duration_ms >= _STT_TAIL_RECOVERY_TRIGGER_MS and has_peer_speech:
        return 0, chunk.duration_ms
    return None


async def _materialize_recovery_windows(
    source_path: Path,
    chunk: _AudioChunk,
    local_start_ms: int,
    local_end_ms: int,
    output_dir: Path,
    req,
) -> list[_RecoveryWindow]:
    windows: list[_RecoveryWindow] = []
    for window_index, (window_start_ms, window_end_ms) in enumerate(
        _split_recovery_range(local_start_ms, local_end_ms)
    ):
        global_start_ms = chunk.start_ms + window_start_ms
        global_end_ms = chunk.start_ms + window_end_ms
        window_path = output_dir / (
            f"recovery-{chunk.index:04d}-{window_index:04d}.wav"
        )
        await _run_ffmpeg_chunk(
            source_path,
            window_path,
            global_start_ms,
            global_end_ms,
            req,
        )
        windows.append(
            _RecoveryWindow(
                chunk_index=chunk.index,
                start_ms=global_start_ms,
                end_ms=global_end_ms,
                path=window_path,
            )
        )
    return windows


def _offset_recovered_segments(
    window: _RecoveryWindow,
    result: TranscribeResult,
) -> list[SttSegment]:
    if not result.segments or _all_zero_timing(result.segments):
        return []
    recovered: list[SttSegment] = []
    for segment in result.segments:
        start_ms = segment.start_ms + window.start_ms
        end_ms = segment.end_ms + window.start_ms
        if start_ms < window.start_ms or end_ms > window.end_ms:
            continue
        recovered.append(
            SttSegment(
                text=segment.text,
                start_ms=start_ms,
                end_ms=end_ms,
                confidence=segment.confidence,
            )
        )
    return recovered


def _log_long_audio_diagnostic(message: str, diagnostic: dict[str, object]) -> None:
    _int_log.info(
        message,
        extra={"event": message, "details": dict(diagnostic), **diagnostic},
    )


async def _transcribe_long_audio(adapter, req, *, chunk_ms: int = _STT_CHUNK_DURATION_MS) -> TranscribeResult:
    """Materialize one long input, transcribe chunks, and recover large tails."""
    source_path = await _download_audio(req.audio_url)
    chunk_diagnostics: list[dict[str, object]] = []
    recovered_segments: list[SttSegment] = []
    recovery_results: list[TranscribeResult] = []
    results: list[TranscribeResult] = []
    chunks: list[_AudioChunk] = []
    merged_segments: list[SttSegment] = []
    try:
        with tempfile.TemporaryDirectory(prefix="transflow-stt-") as chunk_dir:
            chunks = await _materialize_audio_chunks(
                source_path, req.asset_duration_ms, Path(chunk_dir), req, chunk_ms=chunk_ms
            )
            semaphore = asyncio.Semaphore(_STT_CHUNK_CONCURRENCY)

            async def transcribe_local_audio(
                path: Path,
                duration_ms: int,
                malformed_retries: int | None = None,
            ) -> TranscribeResult:
                async with semaphore:
                    return await _transcribe_with_retry(
                        adapter,
                        req,
                        AudioInput.from_file(path, mime_type="audio/wav"),
                        validation_duration_ms=duration_ms,
                        malformed_retries=malformed_retries,
                    )

            async def transcribe_chunk(chunk: _AudioChunk) -> TranscribeResult:
                try:
                    return await transcribe_local_audio(
                        chunk.path,
                        chunk.duration_ms,
                        malformed_retries=_STT_MALFORMED_RETRIES_BEFORE_SPLIT,
                    )
                except ProviderException as exc:
                    if (
                        exc.code != ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED
                        or chunk.duration_ms <= _STT_TAIL_RECOVERY_WINDOW_MS
                    ):
                        raise
                    _int_log.warning(
                        "STT chunk %d stayed malformed (%s); re-transcribing as %d ms windows",
                        chunk.index,
                        exc.message,
                        _STT_TAIL_RECOVERY_WINDOW_MS,
                        extra={"model": req.provider.model, "correlationId": req.correlation_id},
                    )
                windows = await _materialize_recovery_windows(
                    source_path, chunk, 0, chunk.duration_ms, Path(chunk_dir), req
                )
                window_results = await asyncio.gather(
                    *(transcribe_local_audio(w.path, w.duration_ms) for w in windows)
                )
                # Windows are timed globally; the merge expects chunk-local timing.
                segments = [
                    segment.model_copy(update={
                        "start_ms": segment.start_ms - chunk.start_ms,
                        "end_ms": segment.end_ms - chunk.start_ms,
                    })
                    for window, window_result in zip(windows, window_results)
                    for segment in _offset_recovered_segments(window, window_result)
                ]
                return TranscribeResult(
                    segments=segments,
                    detected_lang=next(
                        (r.detected_lang for r in window_results if r.detected_lang), None
                    ),
                    audio_seconds=sum(r.audio_seconds for r in window_results),
                )

            results = list(
                await asyncio.gather(*(transcribe_chunk(chunk) for chunk in chunks))
            )
            peer_speech_indexes = {
                chunk.index
                for chunk, result in zip(chunks, results)
                if _has_real_timed_speech(result)
            }

            for chunk, result in zip(chunks, results):
                initial_max_end_ms = _max_segment_end(result.segments)
                initial_trailing_gap_ms = (
                    max(0, chunk.duration_ms - initial_max_end_ms)
                    if initial_max_end_ms is not None
                    else None
                )
                recovery_range = _chunk_recovery_range(
                    chunk,
                    result,
                    has_peer_speech=any(
                        peer_index != chunk.index
                        for peer_index in peer_speech_indexes
                    ),
                )
                diagnostic: dict[str, object] = {
                    "chunkIndex": chunk.index,
                    "chunkStartMs": chunk.start_ms,
                    "chunkEndMs": chunk.end_ms,
                    "chunkDurationMs": chunk.duration_ms,
                    "initialSegmentCount": len(result.segments or []),
                    "initialMaxEndMs": initial_max_end_ms,
                    "initialTrailingGapMs": initial_trailing_gap_ms,
                    "tailRecoveryTriggered": recovery_range is not None,
                    "recoveryWindowCount": 0,
                    "recoveredSegmentCount": 0,
                    "finalMaxEndMs": initial_max_end_ms,
                    "recoveryState": "NOT_TRIGGERED",
                }

                if recovery_range is not None:
                    recovery_ranges = _split_recovery_range(*recovery_range)
                    diagnostic["recoveryWindowCount"] = len(recovery_ranges)
                    try:
                        windows = await _materialize_recovery_windows(
                            source_path,
                            chunk,
                            recovery_range[0],
                            recovery_range[1],
                            Path(chunk_dir),
                            req,
                        )
                        window_results = await asyncio.gather(
                            *(
                                transcribe_local_audio(
                                    window.path,
                                    window.duration_ms,
                                )
                                for window in windows
                            ),
                            return_exceptions=True,
                        )
                        provider_failure = next(
                            (
                                item
                                for item in window_results
                                if isinstance(item, ProviderException)
                            ),
                            None,
                        )
                        for item in window_results:
                            if isinstance(item, BaseException) and not isinstance(
                                item, ProviderException
                            ):
                                raise item
                        if provider_failure is not None:
                            diagnostic["recoveryState"] = "UNCERTAIN"
                        else:
                            chunk_recovered_segments = [
                                segment
                                for window, window_result in zip(
                                    windows, window_results
                                )
                                for segment in _offset_recovered_segments(
                                    window,
                                    window_result,
                                )
                            ]
                            recovered_segments.extend(chunk_recovered_segments)
                            recovery_results.extend(
                                item
                                for item in window_results
                                if isinstance(item, TranscribeResult)
                            )
                            diagnostic["recoveredSegmentCount"] = len(
                                chunk_recovered_segments
                            )
                            diagnostic["recoveryState"] = (
                                "RECOVERED"
                                if chunk_recovered_segments
                                else "NO_SPEECH"
                            )
                    except ProviderException:
                        diagnostic["recoveryState"] = "UNCERTAIN"

                local_recovered_ends = [
                    segment.end_ms - chunk.start_ms
                    for segment in recovered_segments
                    if chunk.start_ms <= segment.start_ms < chunk.end_ms
                ]
                final_ends = [
                    end_ms
                    for end_ms in [initial_max_end_ms, *local_recovered_ends]
                    if end_ms is not None
                ]
                diagnostic["finalMaxEndMs"] = max(final_ends, default=None)
                chunk_diagnostics.append(diagnostic)
                _log_long_audio_diagnostic("STT_LONG_AUDIO_CHUNK", diagnostic)

            initial_merged_segments = _merge_chunk_transcripts(chunks, results)
            merged_segments = sorted(
                [*initial_merged_segments, *recovered_segments],
                key=lambda segment: (segment.start_ms, segment.end_ms),
            )

        final_max_end_ms = _max_segment_end(merged_segments)
        asset_duration_ms = req.asset_duration_ms
        final_trailing_gap_ms = (
            max(0, asset_duration_ms - final_max_end_ms)
            if final_max_end_ms is not None
            else asset_duration_ms
        )
        final_diagnostic: dict[str, object] = {
            "assetDurationMs": asset_duration_ms,
            "transcriptMaxEndMs": final_max_end_ms,
            "trailingGapMs": final_trailing_gap_ms,
            "trailingGapRatio": (
                final_trailing_gap_ms / asset_duration_ms
                if asset_duration_ms
                else 0.0
            ),
            "recoveredChunkIndexes": [
                diagnostic["chunkIndex"]
                for diagnostic in chunk_diagnostics
                if diagnostic["recoveryState"] == "RECOVERED"
            ],
            "uncertainChunkIndexes": [
                diagnostic["chunkIndex"]
                for diagnostic in chunk_diagnostics
                if diagnostic["recoveryState"] == "UNCERTAIN"
            ],
        }
        _log_long_audio_diagnostic("STT_LONG_AUDIO_SUMMARY", final_diagnostic)
        if not merged_segments:
            raise ProviderValidation(
                "STT detected no speech in the audio",
                code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
                provider=req.provider.base_url,
                protocol=req.provider.protocol,
                capability="STT",
            )

        verdict = TranscriptSanityValidator.validate(
            merged_segments, req.asset_duration_ms, req.source_lang
        )
        _log_sanity_verdict(verdict, req, 0, merged_segments)
        if verdict.result is TranscriptSanityResult.MALFORMED:
            raise ProviderValidation(
                _malformed_message(verdict.violation, req.asset_duration_ms),
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=req.provider.base_url,
                protocol=req.provider.protocol,
                capability="STT",
            )

        all_results = [*results, *recovery_results]
        detected_lang = _detected_language(req.source_lang, all_results)
        audio_seconds = sum(
            max(0.0, result.audio_seconds) for result in all_results
        )
        if audio_seconds <= 0 and req.asset_duration_ms:
            audio_seconds = req.asset_duration_ms / 1000.0
        return TranscribeResult(
            segments=merged_segments,
            detected_lang=detected_lang,
            audio_seconds=audio_seconds,
            metadata={
                "chunked": True,
                "chunk_count": len(chunks),
                "chunkDiagnostics": chunk_diagnostics,
                "longAudioDiagnostics": final_diagnostic,
            },
        )
    finally:
        try:
            source_path.unlink()
        except OSError:
            pass


def _chunk_ranges(
    asset_duration_ms: int,
    chunk_ms: int = _STT_CHUNK_DURATION_MS,
) -> list[tuple[int, int]]:
    return [
        (start_ms, min(start_ms + chunk_ms, asset_duration_ms))
        for start_ms in range(0, asset_duration_ms, chunk_ms)
    ]


async def _materialize_audio_chunks(
    source_path: Path,
    asset_duration_ms: int,
    output_dir: Path,
    req,
    *,
    chunk_ms: int = _STT_CHUNK_DURATION_MS,
) -> list[_AudioChunk]:
    output_dir.mkdir(parents=True, exist_ok=True)
    chunks: list[_AudioChunk] = []
    for index, (start_ms, end_ms) in enumerate(_chunk_ranges(asset_duration_ms, chunk_ms)):
        chunk_path = output_dir / f"chunk-{index:04d}.wav"
        await _run_ffmpeg_chunk(source_path, chunk_path, start_ms, end_ms, req)
        chunks.append(_AudioChunk(index, start_ms, end_ms, chunk_path))
    return chunks


async def _run_ffmpeg_chunk(
    source_path: Path,
    chunk_path: Path,
    start_ms: int,
    end_ms: int,
    req,
) -> None:
    duration_ms = end_ms - start_ms
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_ms / 1000.0:.3f}",
        "-i",
        str(source_path),
        "-t",
        f"{duration_ms / 1000.0:.3f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(chunk_path),
    ]
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await process.communicate()
        except asyncio.CancelledError:
            if process.returncode is None:
                process.terminate()
            raise
    except OSError as exc:
        raise ProviderTransport(
            f"Unable to materialize STT audio chunk: {exc}",
            code=ProviderErrorCode.PROVIDER_TRANSPORT_ERROR,
            provider=req.provider.base_url,
            protocol=req.provider.protocol,
            capability="STT",
        ) from exc
    if process.returncode != 0 or not chunk_path.is_file():
        detail = stderr.decode("utf-8", errors="replace")[-300:]
        raise ProviderTransport(
            "Unable to materialize STT audio chunk"
            + (f": {detail}" if detail else ""),
            code=ProviderErrorCode.PROVIDER_TRANSPORT_ERROR,
            provider=req.provider.base_url,
            protocol=req.provider.protocol,
            capability="STT",
        )


def _merge_chunk_transcripts(
    chunks: Sequence[_AudioChunk],
    results: Sequence[TranscribeResult],
) -> list[SttSegment]:
    raw_segments = [
        segment
        for result in results
        for segment in (result.segments or [])
    ]
    if not raw_segments:
        return []
    # Preserve the documented no-timing sentinel. It cannot be offset without
    # turning it into invalid mixed timing, and the downstream projector owns
    # synthesis for this exact all-zero shape.
    if all(
        segment.start_ms == 0 and segment.end_ms == 0
        for segment in raw_segments
    ):
        return raw_segments

    merged: list[SttSegment] = []
    for chunk, result in zip(chunks, results):
        for segment in result.segments or []:
            merged.append(
                SttSegment(
                    text=segment.text,
                    start_ms=segment.start_ms + chunk.start_ms,
                    end_ms=segment.end_ms + chunk.start_ms,
                    confidence=segment.confidence,
                )
            )
    return merged


def _detected_language(source_lang: str | None, results: Sequence[TranscribeResult]) -> str | None:
    if source_lang and source_lang.strip():
        return source_lang.strip()
    for result in results:
        if result.detected_lang and result.detected_lang.strip():
            return result.detected_lang.strip()
    return None


def _normalize_chunk_transcript(
    result: TranscribeResult,
    chunk_duration_ms: int,
) -> TranscribeResult:
    """Reconcile a small provider tail drift with the materialized chunk boundary."""
    normalized_segments: list[SttSegment] = []
    changed = False
    for segment in result.segments:
        end_ms = segment.end_ms
        if (
            segment.start_ms < chunk_duration_ms < segment.end_ms
            and segment.end_ms - chunk_duration_ms
            <= _STT_CHUNK_BOUNDARY_TOLERANCE_MS
        ):
            end_ms = chunk_duration_ms
            changed = True
        normalized_segments.append(
            SttSegment(
                text=segment.text,
                start_ms=segment.start_ms,
                end_ms=end_ms,
                confidence=segment.confidence,
            )
        )
    if not changed:
        return result
    return TranscribeResult(
        segments=normalized_segments,
        detected_lang=result.detected_lang,
        audio_seconds=result.audio_seconds,
        metadata=dict(result.metadata),
    )


async def _prepare_audio_input(adapter, audio_url: str) -> AudioInput:
    """Choose URL vs downloaded bytes based on what the adapter can consume.

    Adapters declare preference via ``prefers_audio_url()`` — gateways never
    branch on protocol name.
    """
    if adapter.prefers_audio_url():
        return AudioInput.from_url(audio_url)

    # Multipart / binary adapters: download first. Whisper vendors (Groq…)
    # validate the upload by FILENAME extension, so the name must carry a
    # real audio extension — never the temp file's name.
    tmp_path = await _download_audio(audio_url)
    try:
        data = tmp_path.read_bytes()
        suffix = _audio_suffix(audio_url)
        return AudioInput.from_bytes(
            data,
            filename=f"audio{suffix}",
            mime_type=_AUDIO_MIME_BY_SUFFIX[suffix],
        )
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass


async def _transcribe_with_retry(
    adapter,
    req,
    audio_input: AudioInput,
    *,
    validation_duration_ms: int | None = None,
    stop_on_compressed: bool = False,
    malformed_retries: int | None = None,
):
    attempt = 0
    duration_ms = (
        validation_duration_ms
        if validation_duration_ms is not None
        else req.asset_duration_ms
    )
    while True:
        try:
            result = await adapter.transcribe(
                req.provider,
                audio_input,
                source_lang=req.source_lang,
            )
            # STT sanity check (docs/97 §19.15): reject transcripts whose
            # timestamps are inconsistent with the real media duration BEFORE
            # they reach the timing projection. Raising PROVIDER_RESPONSE_
            # MALFORMED (retryable) here reuses the existing retry loop — the
            # provider is re-invoked, never the malformed transcript returned.
            if validation_duration_ms is not None:
                result = _normalize_chunk_transcript(
                    result,
                    validation_duration_ms,
                )
            verdict = TranscriptSanityValidator.validate(
                result.segments, duration_ms, req.source_lang
            )
            _log_sanity_verdict(
                verdict,
                req,
                attempt,
                result.segments,
                validation_duration_ms=duration_ms,
            )
            if verdict.result is TranscriptSanityResult.MALFORMED:
                violation = verdict.violation
                compressed = violation is not None and "compressed" in violation.reason
                raise (_CompressedTimeline if compressed else ProviderValidation)(
                    _malformed_message(violation, duration_ms),
                    code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                    provider=req.provider.base_url,
                    protocol=req.provider.protocol,
                    capability="STT",
                )
            return result
        except ProviderException as exc:
            if stop_on_compressed and isinstance(exc, _CompressedTimeline):
                raise
            retry_limit = settings.max_retries
            if (
                malformed_retries is not None
                and exc.code == ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED
            ):
                retry_limit = min(retry_limit, malformed_retries)
            if exc.retryable and attempt < retry_limit:
                _prov_log.warning(
                    "STT provider retryable error (attempt %d): %s",
                    attempt,
                    exc.code,
                    extra={
                        "errorCode": exc.code,
                        "provider": req.provider.base_url,
                        "protocol": req.provider.protocol,
                        "model": req.provider.model,
                        "correlationId": req.correlation_id,
                        "mediaJobId": req.media_job_id,
                        "assetDurationMs": duration_ms,
                    },
                )
                await _sleep_backoff(attempt)
                attempt += 1
                continue
            raise


_AUDIO_MIME_BY_SUFFIX = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".webm": "audio/webm",
}


def _audio_suffix(audio_url: str) -> str:
    """Audio extension of the (presigned) URL path; EXTRACT_AUDIO emits WAV."""
    suffix = PurePosixPath(urlparse(audio_url).path).suffix.lower()
    return suffix if suffix in _AUDIO_MIME_BY_SUFFIX else ".wav"


async def _download_audio(audio_url: str) -> Path:
    """Stream the audio file to a temporary file."""
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.get(audio_url)
            response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise ProviderTransport(
            f"Timeout downloading audio: {exc}",
            code=ProviderErrorCode.PROVIDER_TIMEOUT,
            provider=audio_url,
        ) from exc
    except httpx.TransportError as exc:
        raise ProviderTransport(
            f"Could not download audio: {exc}",
            provider=audio_url,
        ) from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        code = map_http_status_to_code(status)
        retryable = status in RETRYABLE_HTTP_STATUS or status >= 500
        if not retryable:
            raise ProviderException(
                code,
                f"Audio download failed ({status})",
                provider=audio_url,
            ) from exc
        raise ProviderTransport(
            f"Audio download failed ({status})",
            code=code,
            provider=audio_url,
        ) from exc

    with tempfile.NamedTemporaryFile(delete=False, suffix=_audio_suffix(audio_url)) as tmp:
        tmp.write(response.content)
        return Path(tmp.name)


def _mock_response(req) -> SttResponse:
    detected = req.source_lang or "en"
    segments = [
        SttSegment(text="This is a mock transcript sentence one.", start_ms=0, end_ms=2400),
        SttSegment(text="This is a mock transcript sentence two.", start_ms=2400, end_ms=5100),
    ]
    return SttResponse(
        correlation_id=req.correlation_id,
        status="COMPLETED",
        detected_lang=detected,
        segments=segments,
        usage=SttUsage(audio_seconds=5.1, provider="mock", model="mock"),
    )


async def validate_provider(provider: ProviderPayload) -> ValidateProviderResponse:
    """Legacy STT validate — prefer 4-phase ``/ai/validate/stt-probe``.

    Kept for backward compatibility; probes adapter registration + capability.
    """
    if settings.mock_mode or not settings.key_is_usable(provider.api_key):
        return ValidateProviderResponse(
            ok=True,
            model=provider.model,
            message="STT provider reachable (mock)",
        )

    try:
        adapter = require_adapter(provider.protocol, capability="STT")
    except ProviderException as exc:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message=str(exc)
        )

    # Light auth probe via adapter headers / models path when available.
    path = adapter.auth_probe_path(provider.base_url)
    if not path:
        return ValidateProviderResponse(
            ok=True,
            model=provider.model,
            message="STT adapter registered (no auth probe path)",
        )

    url = provider.base_url.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=min(settings.request_timeout_seconds, 15.0)) as client:
            response = await client.get(url, headers=adapter.auth_headers(provider.api_key))
    except httpx.TimeoutException:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message="Provider timed out",
        )
    except httpx.TransportError as exc:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message=f"Cannot reach provider: {exc}",
        )

    if response.status_code == 401:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message="Invalid API key (401)",
        )
    if response.status_code == 403:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message="API key forbidden (403)",
        )
    if response.status_code >= 400 and not (
        adapter.soft_pass_auth_on_404() and response.status_code == 404
    ):
        return ValidateProviderResponse(
            ok=False,
            model=provider.model,
            message=f"Provider returned error ({response.status_code})",
        )

    return ValidateProviderResponse(
        ok=True, model=provider.model, message="STT provider reachable",
    )


async def _sleep_backoff(attempt: int) -> None:
    delay = (settings.backoff_base_ms / 1000.0) * (2 ** attempt)
    await asyncio.sleep(delay)
