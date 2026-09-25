from __future__ import annotations

import asyncio
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.schemas.contract import ProviderPayload, SttRequest, SttSegment
from app.services import stt_gateway
from app.services.protocol import AudioInputType, TranscribeResult
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderTransport,
    ProviderValidation,
)
from app.services.transcript_sanity import TranscriptSanityResult, TranscriptSanityValidator


def _request(duration_ms: int = 1_440_000) -> SttRequest:
    return SttRequest(
        correlation_id="corr-long",
        media_job_id="job-long",
        audio_ref="audio/long.wav",
        audio_url="https://storage.test/long.wav",
        source_lang=None,
        provider=ProviderPayload(
            protocol="dashscope_native",
            base_url="https://provider.test/v1",
            api_key="sk-real-key",
            model="qwen3.5-omni-plus",
        ),
        asset_duration_ms=duration_ms,
    )


def _chunks(tmp_path: Path, duration_ms: int = 1_440_000) -> list[stt_gateway._AudioChunk]:
    return [
        stt_gateway._AudioChunk(index, start, end, tmp_path / f"chunk-{index}.wav")
        for index, (start, end) in enumerate(stt_gateway._chunk_ranges(duration_ms))
    ]


def _result(text: str, start_ms: int, end_ms: int, language: str = "en") -> TranscribeResult:
    return TranscribeResult(
        segments=[SttSegment(text=text, start_ms=start_ms, end_ms=end_ms)],
        detected_lang=language,
        audio_seconds=(end_ms - start_ms) / 1000.0,
    )


def _near_chunk_end(text: str, chunk: stt_gateway._AudioChunk) -> TranscribeResult:
    return _result(
        text,
        chunk.duration_ms - 2_000,
        chunk.duration_ms - 1_000,
    )


def test_24_minute_audio_has_four_six_minute_ranges() -> None:
    ranges = stt_gateway._chunk_ranges(1_440_000)

    assert ranges == [
        (0, 360_000),
        (360_000, 720_000),
        (720_000, 1_080_000),
        (1_080_000, 1_440_000),
    ]


@pytest.mark.asyncio
async def test_short_successful_empty_result_maps_to_whole_audio_no_speech() -> None:
    adapter = AsyncMock()
    req = _request(600_000)
    empty = TranscribeResult(segments=[], detected_lang="en", audio_seconds=0.0)

    with patch.object(stt_gateway, "require_adapter", return_value=adapter), \
            patch.object(stt_gateway, "_prepare_audio_input", new=AsyncMock(return_value=object())), \
            patch.object(stt_gateway, "_transcribe_with_retry", new=AsyncMock(return_value=empty)):
        with pytest.raises(ProviderValidation) as exc_info:
            await stt_gateway.transcribe(req)

    assert exc_info.value.code is ProviderErrorCode.PROVIDER_EMPTY_RESPONSE


@pytest.mark.asyncio
async def test_long_audio_materializes_once_and_sends_only_local_chunks() -> None:
    adapter = AsyncMock()
    chunks = _chunks(Path("chunk-tests"))
    active = 0
    peak_active = 0

    async def transcribe(provider, audio, *, source_lang=None):
        nonlocal active, peak_active
        active += 1
        peak_active = max(peak_active, active)
        await asyncio.sleep(0)
        active -= 1
        index = int(audio.path.stem.split("-")[-1])
        return _near_chunk_end(f"chunk {index}", chunks[index])

    adapter.transcribe.side_effect = transcribe
    req = _request()

    with patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))) as download, \
            patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)) as materialize, \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        result = await stt_gateway._transcribe_long_audio(adapter, req)

    download.assert_awaited_once_with(req.audio_url)
    materialize.assert_awaited_once()
    assert adapter.transcribe.await_count == 4
    assert peak_active <= 2
    inputs = [call.args[1] for call in adapter.transcribe.await_args_list]
    assert all(audio.type is AudioInputType.UPLOADED_FILE for audio in inputs)
    assert all(audio.path != Path("original.audio") for audio in inputs)
    assert [(segment.start_ms, segment.end_ms) for segment in result.segments] == [
        (358_000, 359_000),
        (718_000, 719_000),
        (1_078_000, 1_079_000),
        (1_438_000, 1_439_000),
    ]
    assert result.metadata["chunk_count"] == 4


@pytest.mark.asyncio
async def test_empty_chunk_does_not_drop_other_chunk_transcript() -> None:
    chunks = _chunks(Path("chunk-tests"), 720_000)
    adapter = AsyncMock()

    async def transcribe(provider, audio, *, source_lang=None):
        if audio.path.stem.startswith("recovery-"):
            if audio.path.stem.endswith("-0000"):
                return _result("recovered", 1_000, 2_000, language="vi")
            return TranscribeResult(segments=[], detected_lang="vi")
        if audio.path.stem == "chunk-0":
            return TranscribeResult(segments=[], detected_lang=None)
        return _result(
            "speech",
            chunks[1].duration_ms - 2_000,
            chunks[1].duration_ms - 1_000,
            language="vi",
        )

    adapter.transcribe.side_effect = transcribe

    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway, "_run_ffmpeg_chunk", new=AsyncMock()), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        result = await stt_gateway._transcribe_long_audio(adapter, _request(720_000))

    assert [segment.text for segment in result.segments] == ["recovered", "speech"]
    assert (result.segments[0].start_ms, result.segments[0].end_ms) == (1_000, 2_000)
    assert result.detected_lang == "vi"
    assert result.metadata["chunkDiagnostics"][0]["recoveryState"] == "RECOVERED"


@pytest.mark.asyncio
async def test_partial_final_chunk_recovers_late_speech_in_bounded_windows() -> None:
    duration_ms = 1_420_132
    chunks = _chunks(Path("chunk-tests"), duration_ms)
    adapter = AsyncMock()
    active = 0
    peak_active = 0

    async def transcribe(provider, audio, *, source_lang=None):
        nonlocal active, peak_active
        active += 1
        peak_active = max(peak_active, active)
        try:
            await asyncio.sleep(0)
            stem = audio.path.stem
            if stem.startswith("recovery-0003"):
                if stem.endswith("-0002"):
                    return _result("late dialogue", 50_000, 52_000)
                return TranscribeResult(segments=[], detected_lang="en")
            index = int(stem.split("-")[-1])
            if index == 3:
                return _result("early tail", 0, 30_958)
            return _near_chunk_end(f"chunk {index}", chunks[index])
        finally:
            active -= 1

    adapter.transcribe.side_effect = transcribe
    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway, "_run_ffmpeg_chunk", new=AsyncMock()) as materialize_recovery, \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        result = await stt_gateway._transcribe_long_audio(adapter, _request(duration_ms))

    assert peak_active <= stt_gateway._STT_CHUNK_CONCURRENCY
    assert "late dialogue" in [segment.text for segment in result.segments]
    assert adapter.transcribe.await_count == 7
    assert [
        (call.args[2], call.args[3])
        for call in materialize_recovery.await_args_list
    ] == [
        (1_110_958, 1_230_958),
        (1_230_958, 1_350_958),
        (1_350_958, 1_420_132),
    ]
    chunk_diagnostic = result.metadata["chunkDiagnostics"][3]
    assert chunk_diagnostic["initialMaxEndMs"] == 30_958
    assert chunk_diagnostic["initialTrailingGapMs"] == 309_174
    assert chunk_diagnostic["tailRecoveryTriggered"] is True
    assert chunk_diagnostic["recoveryWindowCount"] == 3
    assert chunk_diagnostic["recoveredSegmentCount"] == 1
    assert chunk_diagnostic["recoveryState"] == "RECOVERED"
    assert result.metadata["longAudioDiagnostics"]["recoveredChunkIndexes"] == [3]


@pytest.mark.asyncio
async def test_partial_final_chunk_empty_recovery_keeps_initial_transcript() -> None:
    duration_ms = 1_420_132
    chunks = _chunks(Path("chunk-tests"), duration_ms)
    adapter = AsyncMock()

    async def transcribe(provider, audio, *, source_lang=None):
        stem = audio.path.stem
        if stem.startswith("recovery-"):
            return TranscribeResult(segments=[], detected_lang="en")
        index = int(stem.split("-")[-1])
        if index == 3:
            return _result("early tail", 0, 30_958)
        return _near_chunk_end(f"chunk {index}", chunks[index])

    adapter.transcribe.side_effect = transcribe
    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway, "_run_ffmpeg_chunk", new=AsyncMock()), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        result = await stt_gateway._transcribe_long_audio(adapter, _request(duration_ms))

    assert [segment.text for segment in result.segments] == [
        "chunk 0",
        "chunk 1",
        "chunk 2",
        "early tail",
    ]
    assert result.metadata["chunkDiagnostics"][3]["recoveryState"] == "NO_SPEECH"
    assert result.metadata["longAudioDiagnostics"]["recoveredChunkIndexes"] == []


@pytest.mark.asyncio
async def test_partial_final_chunk_recovery_failure_keeps_initial_transcript() -> None:
    duration_ms = 1_420_132
    chunks = _chunks(Path("chunk-tests"), duration_ms)
    adapter = AsyncMock()

    async def transcribe(provider, audio, *, source_lang=None):
        if audio.path.stem.startswith("recovery-"):
            raise ProviderTransport("recovery unavailable")
        index = int(audio.path.stem.split("-")[-1])
        if index == 3:
            return _result("early tail", 0, 30_958)
        return _near_chunk_end(f"chunk {index}", chunks[index])

    adapter.transcribe.side_effect = transcribe
    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway, "_run_ffmpeg_chunk", new=AsyncMock()), \
            patch.object(stt_gateway.settings, "max_retries", 0), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        result = await stt_gateway._transcribe_long_audio(adapter, _request(duration_ms))

    assert [segment.text for segment in result.segments] == [
        "chunk 0",
        "chunk 1",
        "chunk 2",
        "early tail",
    ]
    assert result.metadata["chunkDiagnostics"][3]["recoveryState"] == "UNCERTAIN"
    assert result.metadata["longAudioDiagnostics"]["uncertainChunkIndexes"] == [3]


@pytest.mark.asyncio
async def test_all_zero_timing_sentinel_does_not_trigger_tail_recovery() -> None:
    chunks = _chunks(Path("chunk-tests"), 720_000)
    adapter = AsyncMock()
    adapter.transcribe.side_effect = [
        TranscribeResult(
            segments=[SttSegment(text="untimed", start_ms=0, end_ms=0)],
            detected_lang="en",
        ),
        TranscribeResult(segments=[], detected_lang="en"),
    ]

    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        result = await stt_gateway._transcribe_long_audio(adapter, _request(720_000))

    assert adapter.transcribe.await_count == 2
    assert result.segments[0].start_ms == 0
    assert result.segments[0].end_ms == 0
    assert all(
        diagnostic["tailRecoveryTriggered"] is False
        for diagnostic in result.metadata["chunkDiagnostics"]
    )


@pytest.mark.asyncio
async def test_trailing_gap_below_trigger_does_not_make_extra_provider_calls() -> None:
    chunks = _chunks(Path("chunk-tests"), 720_000)
    adapter = AsyncMock()
    adapter.transcribe.side_effect = [
        _near_chunk_end("chunk 0", chunks[0]),
        _near_chunk_end("chunk 1", chunks[1]),
    ]

    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        result = await stt_gateway._transcribe_long_audio(adapter, _request(720_000))

    assert adapter.transcribe.await_count == 2
    assert all(
        diagnostic["recoveryState"] == "NOT_TRIGGERED"
        for diagnostic in result.metadata["chunkDiagnostics"]
    )


@pytest.mark.asyncio
async def test_final_merge_still_validates_against_original_asset_duration() -> None:
    chunks = [
        stt_gateway._AudioChunk(0, 0, 360_000, Path("chunk-0.wav")),
        stt_gateway._AudioChunk(1, 360_000, 720_001, Path("chunk-1.wav")),
    ]
    adapter = AsyncMock()
    adapter.transcribe.side_effect = [
        _near_chunk_end("chunk 0", chunks[0]),
        _result("overrun after merge", 360_000, 360_001),
    ]

    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        with pytest.raises(ProviderValidation) as exc_info:
            await stt_gateway._transcribe_long_audio(adapter, _request(720_000))

    assert exc_info.value.code is ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED


@pytest.mark.asyncio
async def test_confirmed_empty_chunks_only_fail_as_whole_audio_no_speech() -> None:
    chunks = _chunks(Path("chunk-tests"), 720_000)
    adapter = AsyncMock()
    adapter.transcribe.return_value = TranscribeResult(
        segments=[], detected_lang="en", audio_seconds=0.0
    )

    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        with pytest.raises(ProviderValidation) as exc_info:
            await stt_gateway._transcribe_long_audio(adapter, _request(720_000))

    assert exc_info.value.code is ProviderErrorCode.PROVIDER_EMPTY_RESPONSE
    assert adapter.transcribe.await_count == 2


@pytest.mark.asyncio
async def test_exhausted_provider_empty_chunk_fails_whole_stt_attempt() -> None:
    chunks = _chunks(Path("chunk-tests"), 720_000)
    adapter = AsyncMock()
    adapter.transcribe.side_effect = ProviderValidation(
        "provider returned no STT output",
        code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
        provider="provider",
        protocol="dashscope_native",
        capability="STT",
    )

    async def no_backoff(_attempt: int) -> None:
        return None

    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway, "_sleep_backoff", new=no_backoff), \
            patch.object(stt_gateway.settings, "max_retries", 1), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        with pytest.raises(ProviderValidation) as exc_info:
            await stt_gateway._transcribe_long_audio(adapter, _request(720_000))

    assert exc_info.value.code is ProviderErrorCode.PROVIDER_EMPTY_RESPONSE
    assert adapter.transcribe.await_count >= 2


@pytest.mark.asyncio
async def test_malformed_chunk_retries_only_that_chunk_then_merges() -> None:
    chunks = _chunks(Path("chunk-tests"), 720_000)
    adapter = AsyncMock()
    calls: dict[str, int] = {}

    async def transcribe(provider, audio, *, source_lang=None):
        name = audio.path.name
        calls[name] = calls.get(name, 0) + 1
        if name == "chunk-0.wav" and calls[name] == 1:
            return _result("bad", 0, 720_001)
        index = int(name.split("-")[-1].split(".")[0])
        return _near_chunk_end(name, chunks[index])

    adapter.transcribe.side_effect = transcribe

    async def no_backoff(_attempt: int) -> None:
        return None

    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway, "_sleep_backoff", new=no_backoff), \
            patch.object(stt_gateway.settings, "max_retries", 1), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        result = await stt_gateway._transcribe_long_audio(adapter, _request(720_000))

    assert calls["chunk-0.wav"] == 2
    assert calls["chunk-1.wav"] == 1
    assert [segment.start_ms for segment in result.segments] == [358_000, 718_000]


@pytest.mark.asyncio
async def test_exhausted_chunk_retry_fails_whole_attempt_without_partial_success() -> None:
    chunks = _chunks(Path("chunk-tests"), 720_000)
    adapter = AsyncMock()
    adapter.transcribe.return_value = _result("bad", 0, 720_001)

    async def no_backoff(_attempt: int) -> None:
        return None

    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway, "_sleep_backoff", new=no_backoff), \
            patch.object(stt_gateway, "_run_ffmpeg_chunk", new=AsyncMock()), \
            patch.object(stt_gateway.settings, "max_retries", 1), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        with pytest.raises(ProviderValidation) as exc_info:
            await stt_gateway._transcribe_long_audio(adapter, _request(720_000))

    assert exc_info.value.code is ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED
    assert adapter.transcribe.await_count >= 2


@pytest.mark.asyncio
async def test_final_chunk_boundary_drift_is_clamped_without_retry() -> None:
    duration_ms = 1_420_132
    chunks = _chunks(Path("chunk-tests"), duration_ms)
    adapter = AsyncMock()

    async def transcribe(provider, audio, *, source_lang=None):
        index = int(audio.path.stem.split("-")[-1])
        if index == 3:
            return TranscribeResult(
                segments=[
                    SttSegment(
                        text="tail",
                        start_ms=330_000,
                        end_ms=343_000,
                        confidence=0.8,
                    )
                ],
                detected_lang="en",
                audio_seconds=343.0,
                metadata={"provider_marker": "preserve"},
            )
        return _near_chunk_end(f"chunk {index}", chunks[index])

    adapter.transcribe.side_effect = transcribe
    with patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("original.audio"))), \
            patch.object(stt_gateway.settings, "max_retries", 1), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunk-tests")):
        result = await stt_gateway._transcribe_long_audio(adapter, _request(duration_ms))

    assert adapter.transcribe.await_count == 4
    assert result.segments[-1].end_ms == duration_ms
    assert result.segments[-1].start_ms == 1_410_000


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("start_ms", "end_ms"),
    [(340_133, 341_000), (330_000, 343_133)],
)
async def test_chunk_boundary_hallucination_still_retries(
    start_ms: int,
    end_ms: int,
) -> None:
    adapter = AsyncMock()
    adapter.transcribe.return_value = _result("bad tail", start_ms, end_ms)

    async def no_backoff(_attempt: int) -> None:
        return None

    with patch.object(stt_gateway, "_sleep_backoff", new=no_backoff), \
            patch.object(stt_gateway.settings, "max_retries", 1):
        with pytest.raises(ProviderValidation) as exc_info:
            await stt_gateway._transcribe_with_retry(
                adapter,
                _request(340_132),
                object(),
                validation_duration_ms=340_132,
            )

    assert exc_info.value.code is ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED
    assert adapter.transcribe.await_count == 2


def test_final_merged_transcript_is_validated_against_original_duration() -> None:
    duration_ms = 1_440_000
    chunks = [
        stt_gateway._AudioChunk(0, 0, 360_000, Path("chunk-0.wav")),
        stt_gateway._AudioChunk(1, 360_000, 720_000, Path("chunk-1.wav")),
        stt_gateway._AudioChunk(2, 720_000, 1_080_000, Path("chunk-2.wav")),
        stt_gateway._AudioChunk(3, 1_080_000, duration_ms, Path("chunk-3.wav")),
    ]
    merged = stt_gateway._merge_chunk_transcripts(
        chunks,
        [_result("chunk", 0, 360_000, language="en") for _ in chunks],
    )

    verdict = TranscriptSanityValidator.validate(merged, duration_ms)
    assert verdict.result is TranscriptSanityResult.VALID
    assert merged[-1].end_ms == duration_ms
