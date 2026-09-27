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

# S4 — compressed timeline. LLM-based ASR (observed: DashScope
# ``qwen3-omni-flash``) sometimes squeezes a whole transcript into a fraction
# of the audio (531 s video → every timestamp inside 0–63 s). Every segment
# still fits the duration, so S1/S2 pass, but the implied speaking rate is
# impossible: real transcripts measured ~10–11 non-space chars/s, the
# compressed one ~83. Human speech stays well below 35 chars/s in alphabetic
# scripts, and CJK scripts are denser per char, so the bound is conservative.
MAX_PLAUSIBLE_CHARS_PER_SECOND = 35.0
# Too little text makes the aggregate rate noisy; skip S4 below this size.
MIN_CHARS_FOR_RATE_CHECK = 200
# S5 — partially compressed timeline. The provider may squeeze only some
# sentences (observed 2026-09-24: 531 s video → 0-153 s, individual sentences
# given 300 ms) so the aggregate rate stays under S4. Measured share of text in
# segments above the plausible rate: real transcripts 0 %, compressed 40-49 %.
MAX_TEXT_SHARE_IN_IMPLAUSIBLE_SEGMENTS = 0.3
# S6 — wrong-language transcript. Provider pools (FreeLLMAPI ``auto``) may fall
# back to an English-only model (observed 2026-09-26: ``whisper-tiny-en`` on
# Chinese audio → "I'm very happy." × 60). For a source language written in a
# non-Latin script, a transcript with almost none of that script is a
# hallucination, not code-switching (real zh transcripts: > 80 % Han letters).
MIN_LETTERS_FOR_SCRIPT_CHECK = 20
MIN_EXPECTED_SCRIPT_SHARE = 0.3
_HAN = ((0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF))
_SCRIPT_RANGES_BY_LANG: dict[str, tuple[tuple[int, int], ...]] = {
    "zh": _HAN,
    "yue": _HAN,
    "ja": _HAN + ((0x3040, 0x30FF),),
    "ko": ((0x1100, 0x11FF), (0x3130, 0x318F), (0xAC00, 0xD7AF)),
    "ru": ((0x0400, 0x04FF),),
    "uk": ((0x0400, 0x04FF),),
    "bg": ((0x0400, 0x04FF),),
    "el": ((0x0370, 0x03FF),),
    "he": ((0x0590, 0x05FF),),
    "ar": ((0x0600, 0x06FF),),
    "fa": ((0x0600, 0x06FF),),
    "ur": ((0x0600, 0x06FF),),
    "th": ((0x0E00, 0x0E7F),),
    "hi": ((0x0900, 0x097F),),
}


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
    - S4: aggregate speaking rate (non-space chars / summed segment time)
      above ``MAX_PLAUSIBLE_CHARS_PER_SECOND`` → MALFORMED (compressed
      timeline); only evaluated with at least ``MIN_CHARS_FOR_RATE_CHECK``.
    - S6: ``source_lang`` written in a non-Latin script but under
      ``MIN_EXPECTED_SCRIPT_SHARE`` of the transcript letters use that script
      → MALFORMED (wrong-language / hallucinated transcript).
    - When ``asset_duration_ms`` is absent (legacy caller), duration rules
      (S1-duration / S2) cannot be evaluated → VALID (no-op); local rules
      (negative / zero-length) still apply.
    """

    @staticmethod
    def validate(
        segments: Sequence,
        asset_duration_ms: Optional[int],
        source_lang: Optional[str] = None,
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

        # S4 — implausible aggregate speaking rate ⇒ timestamps were
        # compressed by the provider. Reject so the provider is retried.
        speech_ms = 0
        chars = 0
        chars_in_implausible_segments = 0
        for item in segments:
            segment_ms = int(item.end_ms) - int(item.start_ms)
            segment_chars = len("".join(str(getattr(item, "text", "") or "").split()))
            speech_ms += segment_ms
            chars += segment_chars
            if segment_chars * 1000.0 / segment_ms > MAX_PLAUSIBLE_CHARS_PER_SECOND:
                chars_in_implausible_segments += segment_chars
        if (
            chars >= MIN_CHARS_FOR_RATE_CHECK
            and speech_ms > 0
            and chars * 1000.0 / speech_ms > MAX_PLAUSIBLE_CHARS_PER_SECOND
        ):
            return TranscriptSanityVerdict(
                TranscriptSanityResult.MALFORMED,
                TranscriptSanityViolation(
                    reason="implausible speaking rate "
                           f"({chars * 1000.0 / speech_ms:.1f} chars/s); timestamps look compressed",
                    max_end_ms=max_end_ms,
                ),
            )
        if (
            chars >= MIN_CHARS_FOR_RATE_CHECK
            and chars_in_implausible_segments > chars * MAX_TEXT_SHARE_IN_IMPLAUSIBLE_SEGMENTS
        ):
            return TranscriptSanityVerdict(
                TranscriptSanityResult.MALFORMED,
                TranscriptSanityViolation(
                    reason=f"{chars_in_implausible_segments * 100 // chars}% of the text sits in segments "
                           f"faster than {MAX_PLAUSIBLE_CHARS_PER_SECOND:.0f} chars/s; timestamps look compressed",
                    max_end_ms=max_end_ms,
                ),
            )
        script_violation = _script_mismatch(segments, source_lang, max_end_ms)
        if script_violation is not None:
            return TranscriptSanityVerdict(TranscriptSanityResult.MALFORMED, script_violation)
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


def _script_mismatch(
    segments: Sequence,
    source_lang: Optional[str],
    max_end_ms: int,
) -> Optional[TranscriptSanityViolation]:
    """S6 — the transcript is not written in the source language's script."""
    base_lang = (source_lang or "").strip().lower().replace("_", "-").split("-")[0]
    ranges = _SCRIPT_RANGES_BY_LANG.get(base_lang)
    if ranges is None:
        return None
    letters = [
        char
        for item in segments
        for char in str(getattr(item, "text", "") or "")
        if char.isalpha()
    ]
    if len(letters) < MIN_LETTERS_FOR_SCRIPT_CHECK:
        return None
    in_script = sum(
        1 for char in letters if any(low <= ord(char) <= high for low, high in ranges)
    )
    share = in_script / len(letters)
    if share >= MIN_EXPECTED_SCRIPT_SHARE:
        return None
    return TranscriptSanityViolation(
        reason=f"only {share:.0%} of the transcript letters are in the script of "
               f"source language '{base_lang}'; wrong-language or hallucinated transcript",
        max_end_ms=max_end_ms,
    )
