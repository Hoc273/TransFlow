"""A malformed long-audio chunk is split instead of being retried as-is.

Observed 2026-09-24 (24 min anime, qwen3-omni-flash): dense dialogue in a
6-minute chunk hit the 8 192-token output cap (finish_reason=length, 194
segments) or came back with timestamps past the chunk end; each chunk was
re-sent unchanged four times, then Spring re-ran the whole stage. Shorter
windows need less output and keep timestamps local.
"""
from __future__ import annotations

from contextlib import nullcontext
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.schemas.contract import ProviderPayload, SttRequest, SttSegment
from app.services import stt_gateway
from app.services.protocol import TranscribeResult
from app.services.provider_errors import ProviderErrorCode, ProviderValidation

ASSET_MS = 1_420_132  # the 24-minute episode
SENTENCE = "Where are you going so late at night"


def _request() -> SttRequest:
    return SttRequest(
        correlation_id="corr-split", media_job_id="job-split", audio_ref="audio/a.wav",
        audio_url="https://storage.test/a.wav", source_lang=None,
        provider=ProviderPayload(protocol="dashscope_native", base_url="https://provider.test",
                                 api_key="sk-real-key", model="qwen3-omni-flash"),
        asset_duration_ms=ASSET_MS,
    )


def _speech(duration_ms: int) -> TranscribeResult:
    return TranscribeResult(
        segments=[SttSegment(text=SENTENCE, start_ms=1_000, end_ms=4_000),
                  SttSegment(text=SENTENCE, start_ms=duration_ms - 5_000, end_ms=duration_ms - 2_000)],
        detected_lang="en", audio_seconds=duration_ms / 1000.0)


async def test_malformed_chunk_is_split_into_short_windows_after_one_retry() -> None:
    chunks = [stt_gateway._AudioChunk(i, s, e, Path(f"chunk-{i}.wav"))
              for i, (s, e) in enumerate(stt_gateway._chunk_ranges(ASSET_MS))]
    calls: dict[str, int] = {}

    async def transcribe(provider, audio, *, source_lang=None):
        name = audio.path.stem
        calls[name] = calls.get(name, 0) + 1
        if name == "chunk-1":  # the dense chunk: output cap every time it is sent whole
            raise ProviderValidation("DashScope STT incomplete stream (provider output limit reached)",
                                     code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED)
        if name.startswith("recovery-"):
            return _speech(stt_gateway._STT_TAIL_RECOVERY_WINDOW_MS)
        return _speech(chunks[int(name.split("-")[-1])].duration_ms)

    adapter = AsyncMock()
    adapter.transcribe.side_effect = transcribe
    with patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("a.audio"))), \
            patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_run_ffmpeg_chunk", new=AsyncMock()), \
            patch.object(stt_gateway, "_sleep_backoff", new=AsyncMock()), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunks")):
        result = await stt_gateway._transcribe_long_audio(adapter, _request())

    assert calls["chunk-1"] == 2, "one retry, then split - not four identical requests"
    assert sum(1 for name in calls if name.startswith("recovery-0001-")) == 3  # 6 min / 2 min windows
    chunk1 = chunks[1]
    inside = [s for s in result.segments if chunk1.start_ms <= s.start_ms < chunk1.end_ms]
    assert len(inside) == 6, "each window's speech lands on the global timeline of chunk 1"
    assert all(s.end_ms <= chunk1.end_ms for s in inside)
    assert [s.start_ms for s in result.segments] == sorted(s.start_ms for s in result.segments)


async def test_non_malformed_chunk_failure_is_not_split() -> None:
    chunks = [stt_gateway._AudioChunk(0, 0, 360_000, Path("chunk-0.wav"))]
    adapter = AsyncMock()
    adapter.transcribe.side_effect = ProviderValidation("quota", code=ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED)
    with patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("a.audio"))), \
            patch.object(stt_gateway, "_materialize_audio_chunks", new=AsyncMock(return_value=chunks)), \
            patch.object(stt_gateway, "_run_ffmpeg_chunk", new=AsyncMock()) as cut, \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunks")), \
            pytest.raises(ProviderValidation):
        await stt_gateway._transcribe_long_audio(adapter, _request())

    cut.assert_not_awaited()
