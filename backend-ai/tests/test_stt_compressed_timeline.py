"""Partially compressed STT timelines and the chunked fallback.

Real case (2026-09-24): ``qwen3-omni-flash`` transcribed the full dialogue of a
531 s video but squeezed its timestamps into 0-153 s unevenly — some sentences
got 300 ms, others looked normal. The aggregate rate (27-31 chars/s) stayed
under the S4 bound, so the transcript passed and SUMMARIZE could not find 300 s
of footage. Measured: good transcript 0 % of text in segments > 35 chars/s,
compressed ones 40-49 %.
"""
from __future__ import annotations

from contextlib import nullcontext
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.schemas.contract import ProviderPayload, SttRequest, SttSegment
from app.services import stt_gateway
from app.services.protocol import TranscribeResult
from app.services.transcript_sanity import TranscriptSanityResult, TranscriptSanityValidator

SENTENCE = "Trong khi ba chú thỏ con đang đi dạo trong rừng"  # 37 non-space chars
ASSET_MS = 531_505


def _partially_compressed(count: int = 80) -> list[SttSegment]:
    segments, cursor = [], 0
    for index in range(count):
        length = 300 if index % 2 else 4_000  # every other sentence gets an impossible 300 ms
        segments.append(SttSegment(text=SENTENCE, start_ms=cursor, end_ms=cursor + length))
        cursor += length
    return segments


def test_partially_compressed_timeline_is_malformed_even_with_a_plausible_average_rate() -> None:
    verdict = TranscriptSanityValidator.validate(_partially_compressed(), ASSET_MS)

    assert verdict.result is TranscriptSanityResult.MALFORMED
    assert "compressed" in verdict.violation.reason


def test_a_few_fast_segments_in_a_real_timeline_stay_valid() -> None:
    # Quick exchanges and slightly early end stamps happen in real transcripts.
    segments, cursor = [], 0
    for index in range(80):
        length = 900 if index % 10 == 0 else 4_000
        segments.append(SttSegment(text=SENTENCE, start_ms=cursor, end_ms=cursor + length))
        cursor += length + 2_000

    assert TranscriptSanityValidator.validate(segments, ASSET_MS).result is TranscriptSanityResult.VALID


def _request() -> SttRequest:
    return SttRequest(
        correlation_id="corr-compressed",
        media_job_id="job-compressed",
        audio_ref="audio/a.wav",
        audio_url="https://storage.test/a.wav",
        source_lang="vi",
        provider=ProviderPayload(protocol="dashscope_native", base_url="https://provider.test",
                                 api_key="sk-real-key", model="qwen3-omni-flash"),
        asset_duration_ms=ASSET_MS,
    )


async def test_compressed_single_call_falls_back_to_short_chunks_without_repeating_the_long_call() -> None:
    full_audio = object()
    chunk_ranges = stt_gateway._chunk_ranges(ASSET_MS, stt_gateway._STT_FALLBACK_CHUNK_MS)
    chunks = [stt_gateway._AudioChunk(i, s, e, Path(f"chunk-{i}.wav")) for i, (s, e) in enumerate(chunk_ranges)]

    async def transcribe(provider, audio, *, source_lang=None):
        if audio is full_audio:
            return TranscribeResult(segments=_partially_compressed(), detected_lang="vi", audio_seconds=153.0)
        chunk = chunks[int(audio.path.stem.split("-")[-1])]
        return TranscribeResult(
            segments=[SttSegment(text=SENTENCE, start_ms=1_000, end_ms=min(6_000, chunk.duration_ms - 500)),
                      SttSegment(text=SENTENCE, start_ms=chunk.duration_ms - 6_000,
                                 end_ms=chunk.duration_ms - 1_000)],
            detected_lang="vi", audio_seconds=chunk.duration_ms / 1000.0)

    adapter = AsyncMock()
    adapter.transcribe.side_effect = transcribe
    materialize = AsyncMock(return_value=chunks)
    with patch.object(stt_gateway, "require_adapter", return_value=adapter), \
            patch.object(stt_gateway.settings, "mock_mode", False), \
            patch.object(stt_gateway, "_prepare_audio_input", new=AsyncMock(return_value=full_audio)), \
            patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=Path("a.audio"))), \
            patch.object(stt_gateway, "_materialize_audio_chunks", new=materialize), \
            patch.object(stt_gateway.tempfile, "TemporaryDirectory", return_value=nullcontext("chunks")):
        response = await stt_gateway.transcribe(_request())

    full_calls = [call for call in adapter.transcribe.await_args_list if call.args[1] is full_audio]
    assert len(full_calls) == 1, "a compressed long call is not repeated; chunks recover the timing"
    assert materialize.await_args.kwargs["chunk_ms"] == stt_gateway._STT_FALLBACK_CHUNK_MS
    assert response.status == "COMPLETED"
    assert response.segments[-1].end_ms > 500_000, "timeline spans the real audio again"
