"""STT transcript timing sanity validator + gateway retry (docs/97 §19.15).

Root cause regression: LLM-based ASR (DashScope qwen3.5-omni-plus) returned a
transcript whose tail segments carried fabricated timestamps beyond the real
audio duration (asset 131243 ms, tail at 200000–210000 ms). The segments look
locally valid (start < end) so the timing projector passed them through, the
overlap filter dropped them, real tail speech lost its segments, and the
RENDER duration gate failed closed with DURATION_MISMATCH.

This suite pins the validator rules (S1–S4) and the gateway behaviour:
malformed timing → PROVIDER_RESPONSE_MALFORMED (retryable) → existing retry
loop re-invokes the provider; the malformed transcript never leaves the
gateway.
"""
from __future__ import annotations

import unittest
from unittest.mock import AsyncMock

from app.schemas.contract import ProviderPayload, SttRequest
from app.services import stt_gateway
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderValidation,
)
from app.services.transcript_sanity import (
    TranscriptSanityResult,
    TranscriptSanityValidator,
)


def _provider() -> ProviderPayload:
    return ProviderPayload(
        protocol="dashscope_native",
        base_url="https://provider.test/v1",
        api_key="sk-real-key",
        model="qwen3.5-omni-plus",
    )


def _request(asset_duration_ms: int | None = 131_243) -> SttRequest:
    return SttRequest(
        correlation_id="corr-1",
        media_job_id="job-1",
        audio_ref="audio/1.wav",
        audio_url="http://minio/audio/1.wav",
        source_lang=None,
        provider=_provider(),
        asset_duration_ms=asset_duration_ms,
    )


def _seg(start_ms: int, end_ms: int, text: str = "x") -> object:
    from app.schemas.contract import SttSegment

    return SttSegment(text=text, start_ms=start_ms, end_ms=end_ms)


class TranscriptSanityValidatorTest(unittest.TestCase):
    """Rule matrix S1–S4 (docs/97 §19.15 §3–4)."""

    # ── VALID ────────────────────────────────────────────────────────────

    def test_valid_transcript_within_duration(self):
        verdict = TranscriptSanityValidator.validate(
            [_seg(0, 1000), _seg(1500, 3000)], 131_243
        )
        self.assertIs(verdict.result, TranscriptSanityResult.VALID)

    def test_valid_single_segment(self):
        verdict = TranscriptSanityValidator.validate([_seg(0, 5000)], 10_000)
        self.assertIs(verdict.result, TranscriptSanityResult.VALID)

    def test_valid_segment_ending_exactly_at_duration(self):
        verdict = TranscriptSanityValidator.validate([_seg(0, 131_243)], 131_243)
        self.assertIs(verdict.result, TranscriptSanityResult.VALID)

    def test_empty_transcript_is_valid_no_speech_outcome(self):
        # Q-M-D3: silent audio → empty transcript is NOT malformed.
        verdict = TranscriptSanityValidator.validate([], 131_243)
        self.assertIs(verdict.result, TranscriptSanityResult.VALID)

    def test_all_zero_timestamp_sentinel_is_valid(self):
        # Q-M-E4: providers without word-level timings emit 0/0 — the timing
        # projector synthesizes timings; the sentinel is a documented fallback.
        verdict = TranscriptSanityValidator.validate(
            [_seg(0, 0, "a"), _seg(0, 0, "b")], 131_243
        )
        self.assertIs(verdict.result, TranscriptSanityResult.VALID)

    def test_long_silence_inside_valid_timeline_is_suspicious_not_malformed(self):
        # S3: a 90 s silent stretch with timestamps still inside the duration
        # is kept (SUSPICIOUS), never rejected.
        verdict = TranscriptSanityValidator.validate(
            [_seg(0, 1000), _seg(91_000, 92_000), _seg(95_000, 100_000)],
            200_000,
        )
        self.assertIs(verdict.result, TranscriptSanityResult.SUSPICIOUS)
        self.assertEqual(verdict.violation.largest_gap_ms, 90_000)

    def test_valid_gap_below_threshold(self):
        verdict = TranscriptSanityValidator.validate(
            [_seg(0, 10_000), _seg(20_000, 30_000)], 60_000
        )
        self.assertIs(verdict.result, TranscriptSanityResult.VALID)

    def test_asset_duration_absent_skips_duration_rules(self):
        # Legacy caller without asset_duration_ms → duration rules skipped;
        # the local gap rule still applies (SUSPICIOUS is a diagnostic, not
        # a rejection).
        verdict = TranscriptSanityValidator.validate(
            [_seg(0, 200_000), _seg(300_000, 400_000)], None
        )
        self.assertIs(verdict.result, TranscriptSanityResult.SUSPICIOUS)

    # ── MALFORMED (S1/S2) ────────────────────────────────────────────────

    def test_start_ms_beyond_duration_malformed(self):
        verdict = TranscriptSanityValidator.validate([_seg(140_000, 145_000)], 131_243)
        self.assertIs(verdict.result, TranscriptSanityResult.MALFORMED)
        self.assertIn("exceeds media duration", verdict.violation.reason)
        self.assertEqual(verdict.violation.first_invalid_index, 0)

    def test_end_ms_beyond_duration_malformed(self):
        verdict = TranscriptSanityValidator.validate([_seg(0, 131_244)], 131_243)
        self.assertIs(verdict.result, TranscriptSanityResult.MALFORMED)

    def test_negative_start_malformed(self):
        verdict = TranscriptSanityValidator.validate([_seg(-1, 1000)], 131_243)
        self.assertIs(verdict.result, TranscriptSanityResult.MALFORMED)

    def test_zero_length_segment_malformed(self):
        verdict = TranscriptSanityValidator.validate([_seg(1000, 1000)], 131_243)
        self.assertIs(verdict.result, TranscriptSanityResult.MALFORMED)

    def test_reversed_segment_malformed(self):
        verdict = TranscriptSanityValidator.validate([_seg(5000, 1000)], 131_243)
        self.assertIs(verdict.result, TranscriptSanityResult.MALFORMED)

    def test_span_exceeding_duration_malformed_even_if_last_segment_fits(self):
        # S1/S2: a segment ending beyond the duration is malformed regardless
        # of the valid prefix. The violation names the first offending segment.
        verdict = TranscriptSanityValidator.validate(
            [_seg(0, 1000), _seg(1500, 131_244)], 131_243
        )
        self.assertIs(verdict.result, TranscriptSanityResult.MALFORMED)
        self.assertEqual(verdict.violation.first_invalid_index, 1)
        self.assertEqual(verdict.violation.first_invalid_end_ms, 131_244)

    def test_real_world_case_131243_with_fabricated_tail_200s(self):
        # Regression: the exact production case — segments 1..37 end at
        # 119840, tail segments carry 200000..210000 (beyond the 131243 ms
        # asset). The tail is malformed, not "a long silence".
        segments = [_seg(0, 119_840)] + [_seg(200_000, 210_000)]
        verdict = TranscriptSanityValidator.validate(segments, 131_243)
        self.assertIs(verdict.result, TranscriptSanityResult.MALFORMED)
        self.assertEqual(verdict.violation.first_invalid_index, 1)
        self.assertEqual(verdict.violation.first_invalid_start_ms, 200_000)

    def test_non_integer_timestamps_malformed(self):
        verdict = TranscriptSanityValidator.validate(
            [{"text": "x", "start_ms": "0", "end_ms": 1000}], 131_243
        )
        self.assertIs(verdict.result, TranscriptSanityResult.MALFORMED)


class SttGatewaySanityIntegrationTest(unittest.IsolatedAsyncioTestCase):
    """Malformed timing → retryable PROVIDER_RESPONSE_MALFORMED → retry."""

    async def test_malformed_timing_raises_retryable_and_never_returns(self):
        adapter = AsyncMock()
        adapter.prefers_audio_url.return_value = True
        adapter.transcribe.return_value = type(
            "TranscribeResult",
            (),
            {
                "segments": [_seg(0, 119_840), _seg(200_000, 210_000)],
                "detected_lang": "zh",
            },
        )()

        # The provider returns a malformed transcript on EVERY attempt: after
        # max_retries the final ProviderException must surface with the
        # malformed code — the malformed transcript is never returned.
        import asyncio

        async def _sleep(_attempt: int) -> None:
            pass  # no real backoff in tests

        with self.assertRaises(ProviderValidation) as ctx:
            with unittest.mock.patch.object(stt_gateway, "_sleep_backoff", _sleep):
                await stt_gateway._transcribe_with_retry(
                    adapter, _request(131_243), None
                )
        self.assertEqual(
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code
        )
        self.assertTrue(ctx.exception.retryable)
        self.assertIn("assetDurationMs=131243", str(ctx.exception))
        self.assertIn("firstInvalidStartMs=200000", str(ctx.exception))
        self.assertIn("firstInvalidEndMs=210000", str(ctx.exception))
        # adapter.transcribe was invoked once + max_retries retries.
        self.assertEqual(adapter.transcribe.await_count, 4)

    async def test_malformed_then_valid_retry_succeeds(self):
        import asyncio

        adapter = AsyncMock()
        adapter.prefers_audio_url.return_value = True
        async def _transcribe(provider, audio, *, source_lang=None):
            adapter._calls = getattr(adapter, "_calls", 0) + 1
            if adapter._calls == 1:
                return type(
                    "TranscribeResult",
                    (),
                    {
                        "segments": [_seg(0, 119_840), _seg(200_000, 210_000)],
                        "detected_lang": "zh",
                    },
                )()
            return type(
                "TranscribeResult",
                (),
                {"segments": [_seg(0, 131_243)], "detected_lang": "zh"},
            )()
        adapter.transcribe = _transcribe

        async def _sleep(_attempt: int) -> None:
            pass

        with unittest.mock.patch.object(stt_gateway, "_sleep_backoff", _sleep):
            result = await stt_gateway._transcribe_with_retry(
                adapter, _request(131_243), None
            )
        self.assertEqual(result.segments[0].end_ms, 131_243)

    async def test_valid_transcript_passes_through(self):
        adapter = AsyncMock()
        adapter.prefers_audio_url.return_value = True
        adapter.transcribe.return_value = type(
            "TranscribeResult",
            (),
            {"segments": [_seg(0, 1000), _seg(2000, 3000)], "detected_lang": "vi"},
        )()

        result = await stt_gateway._transcribe_with_retry(
            adapter, _request(131_243), None
        )
        self.assertEqual(len(result.segments), 2)
        adapter.transcribe.await_count == 1


if __name__ == "__main__":
    unittest.main()
