"""STT transcript timing sanity validation (docs/97 §19.15).

Rejects transcripts whose timestamps are inconsistent with the real media
duration BEFORE they reach the timing projection / subtitle pipeline.

Why this exists (root cause, 2026-08-15): LLM-based ASR providers
(e.g. DashScope ``qwen3.5-omni-plus``) occasionally emit a transcript whose
final segments carry fabricated timestamps BEYOND the actual audio duration
(observed: asset 131243 ms, tail segments at 200000–210000 ms). Such segments
look "valid" (``start_ms < end_ms``) so downstream projection passes them
through, the overlap filter drops them (outside the cut ranges), real speech
at the tail loses its segments, and the RENDER duration gate fails closed
with ``DURATION_MISMATCH`` — a dead-end the user cannot fix by editing cues.

Design invariants (docs/97 §19.15, S1–S4):
- Validator is PURE: no clamping, shifting, redistribution, interpolation or
  segment merging. It only returns VALID / MALFORMED / SUSPICIOUS.
- A transcript is never repaired here — malformed input must be rejected so
  the caller retries the provider (``PROVIDER_RESPONSE_MALFORMED`` is
  retryable in the existing STT retry infrastructure).
- An EMPTY segment list is NOT malformed: silent audio is a legitimate
  "no speech" outcome (Q-M-D3) handled upstream as PROVIDER_EMPTY_RESPONSE.
- A long inter-segment gap (> 60 s) is only a hard failure when it combines
  with evidence of timestamp inconsistency (segments beyond the duration);
  a long silence inside a valid timeline is kept (SUSPICIOUS, logged).
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence

# S3 — a gap this large between consecutive segments is suspicious.
SUSPICIOUS_GAP_THRESHOLD_MS = 60_000


class TranscriptSanityResult(str, Enum):
    VALID = "VALID"
    MALFORMED = "MALFORMED"
    SUSPICIOUS = "SUSPICIOUS"


@dataclass(frozen=True)
class TranscriptSanityViolation:
    """Structured diagnostic metadata — never contains credentials."""

    reason: str
    first_invalid_index: Optional[int] = None
    first_invalid_start_ms: Optional[int] = None
    first_invalid_end_ms: Optional[int] = None
    largest_gap_ms: Optional[int] = None
    gap_before_index: Optional[int] = None
    max_end_ms: Optional[int] = None


@dataclass(frozen=True)
class TranscriptSanityVerdict:
    result: TranscriptSanityResult
    violation: Optional[TranscriptSanityViolation] = None


class TranscriptSanityValidator:
    """Pure structural timing validator for STT transcripts.

    Rules (docs/97 §19.15):
    - S1: any segment with ``start_ms < 0``, ``end_ms <= start_ms``,
      ``start_ms > asset_duration_ms`` or ``end_ms > asset_duration_ms``
      → MALFORMED (first offending segment recorded).
    - S2: ``max(end_ms) > asset_duration_ms`` → MALFORMED. Never clamped.
    - S3: consecutive gap ``next.start - prev.end > 60 s`` → SUSPICIOUS when
      every timestamp still fits inside the duration; MALFORMED when the gap
      combines with timestamp evidence beyond the duration (S1/S2 already
      catch the latter — S3 only adds the diagnostic classification).
    - When ``asset_duration_ms`` is absent (legacy caller), duration rules
      (S1-duration / S2) cannot be evaluated → VALID (no-op); local rules
      (negative / zero-length) still apply.
    """

    @staticmethod
    def validate(
        segments: Sequence,
        asset_duration_ms: Optional[int],
    ) -> TranscriptSanityVerdict:
        if not segments:
            # Empty transcript = legitimate "no speech" (Q-M-D3) — the caller
            # decides (PROVIDER_EMPTY_RESPONSE); never malformed here.
            return TranscriptSanityVerdict(TranscriptSanityResult.VALID)

        if all(
            getattr(s, "start_ms", None) == 0 and getattr(s, "end_ms", None) == 0
            for s in segments
        ):
            # All-zero timestamp sentinel (Q-M-E4, docs/14 §5): STT providers
            # without word-level timings legitimately emit 0/0 — the timing
            # projector synthesizes timings and cut_ranges are authoritative.
            # Rejecting this documented fallback would break providers whose
            # transcripts carry no timing at all.
            return TranscriptSanityVerdict(TranscriptSanityResult.VALID)

        max_end_ms = 0
        largest_gap_ms = 0
        gap_before_index: Optional[int] = None
        previous_end_ms: Optional[int] = None

        for index, item in enumerate(segments):
            try:
                start_ms = int(item.start_ms)  # SttSegment-like
                end_ms = int(item.end_ms)
            except (AttributeError, TypeError, ValueError):
                return TranscriptSanityVerdict(
                    TranscriptSanityResult.MALFORMED,
                    TranscriptSanityViolation(
                        reason="segment timestamps are not integers",
                        first_invalid_index=index,
                    ),
                )

            if start_ms < 0 or end_ms <= start_ms:
                return TranscriptSanityVerdict(
                    TranscriptSanityResult.MALFORMED,
                    TranscriptSanityViolation(
                        reason="segment has invalid local timestamps "
                               "(start_ms < 0 or end_ms <= start_ms)",
                        first_invalid_index=index,
                        first_invalid_start_ms=start_ms,
                        first_invalid_end_ms=end_ms,
                        max_end_ms=max_end_ms,
                    ),
                )

            if asset_duration_ms is not None:
                if start_ms > asset_duration_ms or end_ms > asset_duration_ms:
                    return TranscriptSanityVerdict(
                        TranscriptSanityResult.MALFORMED,
                        TranscriptSanityViolation(
                            reason="segment timestamp exceeds media duration",
                            first_invalid_index=index,
                            first_invalid_start_ms=start_ms,
                            first_invalid_end_ms=end_ms,
                            max_end_ms=max_end_ms,
                        ),
                    )

            max_end_ms = max(max_end_ms, end_ms)

            if previous_end_ms is not None:
                gap = start_ms - previous_end_ms
                if gap > largest_gap_ms:
                    largest_gap_ms = gap
                    gap_before_index = index
            previous_end_ms = end_ms

        # S2 — transcript span must never exceed the media duration. Never
        # clamp; the transcript must be rejected so the provider is retried.
        if asset_duration_ms is not None and max_end_ms > asset_duration_ms:
            return TranscriptSanityVerdict(
                TranscriptSanityResult.MALFORMED,
                TranscriptSanityViolation(
                    reason="transcript span exceeds media duration",
                    max_end_ms=max_end_ms,
                    largest_gap_ms=largest_gap_ms,
                    gap_before_index=gap_before_index,
                ),
            )

        # S3 — a long gap alone is only suspicious, never a hard failure:
        # a legitimate video may contain a long silent stretch. When the gap
        # combined with out-of-duration evidence, S1/S2 already rejected it.
        if largest_gap_ms > SUSPICIOUS_GAP_THRESHOLD_MS:
            return TranscriptSanityVerdict(
                TranscriptSanityResult.SUSPICIOUS,
                TranscriptSanityViolation(
                    reason="suspicious long gap between consecutive segments",
                    largest_gap_ms=largest_gap_ms,
                    gap_before_index=gap_before_index,
                    max_end_ms=max_end_ms,
                ),
            )

        return TranscriptSanityVerdict(TranscriptSanityResult.VALID)
