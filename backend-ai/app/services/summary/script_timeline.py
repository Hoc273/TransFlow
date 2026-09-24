"""Deterministic footage fitting for script-first summaries.

LLMs are unreliable at duration arithmetic (flash models routinely return a
third of the requested footage), so the model only *chooses* which moments
match its script; this module owns the requested duration window, as the
original narrative allocator did. Every adjustment stays on transcript
sentence boundaries where possible and never crosses the transcript extent.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Same ±20% window Spring enforces in SummarizationServiceImpl.
DURATION_TOLERANCE_RATIO = 0.2
MIN_SEGMENT_MS = 1000


@dataclass
class TimelineSegment:
    start_ms: int
    end_ms: int
    script_excerpt: str
    source_sentence_refs: list[str] = field(default_factory=list)
    reasoning_note: str | None = None

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


class DurationUnreachable(ValueError):
    """The source footage cannot satisfy the window; asking the model again will not help."""


def duration_window(requested_ms: int) -> tuple[int, int]:
    # Mirrors Java's (long) casts so both layers accept the same totals.
    return int(requested_ms * (1 - DURATION_TOLERANCE_RATIO)), int(requested_ms * (1 + DURATION_TOLERANCE_RATIO))


def total_ms(segments: list[TimelineSegment]) -> int:
    return sum(segment.duration_ms for segment in segments)


def fit_to_window(
    segments: list[TimelineSegment],
    sentences: list[tuple[int, int]],
    requested_ms: int,
) -> tuple[list[TimelineSegment], bool]:
    """Return non-overlapping segments whose total lies in the requested window.

    ``sentences`` are transcript ``(start_ms, end_ms)`` pairs. The boolean
    reports whether the model's selection had to be changed.
    """
    lower, upper = duration_window(requested_ms)
    extent = max((end for _, end in sentences), default=0) or max((s.end_ms for s in segments), default=0)
    before = [(s.start_ms, s.end_ms) for s in segments]

    fitted = _without_overlaps(_clamped(segments, extent))
    if not fitted:
        raise DurationUnreachable("No matched video segment lies inside the source transcript")
    if extent < lower:
        raise DurationUnreachable(
            f"Requested summary duration {requested_ms} ms cannot be matched: "
            f"the transcript covers only {extent} ms (minimum {lower} ms). "
            "Rerun STT if the transcript is shorter than the video, or request a shorter summary"
        )

    if total_ms(fitted) < lower:
        _extend(fitted, sentences, extent, target=requested_ms, upper=upper)
    elif total_ms(fitted) > upper:
        _trim(fitted, sentences, target=requested_ms, lower=lower)

    final = total_ms(fitted)
    if final < lower or final > upper:
        raise DurationUnreachable(
            f"Matched segment duration could not be fitted to the requested window "
            f"(matched {final} ms, allowed {lower}-{upper} ms)"
        )
    return fitted, before != [(s.start_ms, s.end_ms) for s in fitted]


def _clamped(segments: list[TimelineSegment], extent: int) -> list[TimelineSegment]:
    result = []
    for segment in segments:
        start = max(0, segment.start_ms)
        end = min(extent, segment.end_ms) if extent else segment.end_ms
        if end > start:
            segment.start_ms, segment.end_ms = start, end
            result.append(segment)
    return result


def _without_overlaps(segments: list[TimelineSegment]) -> list[TimelineSegment]:
    result: list[TimelineSegment] = []
    for segment in sorted(segments, key=lambda s: (s.start_ms, s.end_ms)):
        if result and segment.start_ms < result[-1].end_ms:
            segment.start_ms = result[-1].end_ms
        if segment.end_ms > segment.start_ms:
            result.append(segment)
    return result


def _extend(
    segments: list[TimelineSegment],
    sentences: list[tuple[int, int]],
    extent: int,
    *,
    target: int,
    upper: int,
) -> None:
    """Grow segments into neighbouring footage, smallest step first, until ``target``."""
    ends = sorted({end for _, end in sentences})
    starts = sorted({start for start, _ in sentences})
    while total_ms(segments) < target:
        budget = upper - total_ms(segments)
        best: tuple[int, int, str, int] | None = None  # (delta, index, side, new_edge)
        for index, segment in enumerate(segments):
            right_limit = segments[index + 1].start_ms if index + 1 < len(segments) else extent
            left_limit = segments[index - 1].end_ms if index > 0 else 0
            if right_limit > segment.end_ms:
                edge = next((end for end in ends if end > segment.end_ms), right_limit)
                edge = min(edge, right_limit, segment.end_ms + budget)
                candidate = (edge - segment.end_ms, index, "right", edge)
                if candidate[0] > 0 and (best is None or candidate[0] < best[0]):
                    best = candidate
            if left_limit < segment.start_ms:
                edge = next((start for start in reversed(starts) if start < segment.start_ms), left_limit)
                edge = max(edge, left_limit, segment.start_ms - budget)
                candidate = (segment.start_ms - edge, index, "left", edge)
                if candidate[0] > 0 and (best is None or candidate[0] < best[0]):
                    best = candidate
        if best is None:
            return
        _, index, side, edge = best
        if side == "right":
            segments[index].end_ms = edge
        else:
            segments[index].start_ms = edge


def _trim(
    segments: list[TimelineSegment],
    sentences: list[tuple[int, int]],
    *,
    target: int,
    lower: int,
) -> None:
    """Shorten the longest segments first, snapping to a sentence end when that stays in the window."""
    ends = sorted({end for _, end in sentences})
    while total_ms(segments) > target:
        longest = max(segments, key=lambda s: s.duration_ms)
        cut = min(total_ms(segments) - target, longest.duration_ms - MIN_SEGMENT_MS)
        if cut <= 0:
            return
        new_end = longest.end_ms - cut
        snapped = next((end for end in reversed(ends) if longest.start_ms + MIN_SEGMENT_MS <= end <= new_end), None)
        if snapped is not None and total_ms(segments) - (longest.end_ms - snapped) >= lower:
            new_end = snapped
        longest.end_ms = new_end
