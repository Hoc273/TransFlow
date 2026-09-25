"""Chronological section coverage for script-first summaries.

Models pick a handful of long ranges, usually clustered near the start of the
video, so a summary built from their choice alone skips most of the source.
The original narrative allocator avoided that deterministically: the whole
transcript was cut into chronological blocks (~45 s), every block received a
share of the requested duration, and the selection was split into small
presentation beats (~6 s). This module does the same for the script-first
flow. The model's matched segments only *anchor* where inside each block the
footage is taken and donate their excerpts as narration drafts; which parts of
the video are covered never depends on the model.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from app.services.summary.script_timeline import TimelineSegment

WINDOW_TARGET_MS = 45_000
TARGET_BEAT_MS = 6_000
MIN_BEAT_MS = 4_000
# A beat boundary moves to a sentence boundary only when that keeps both sides at least this long.
MIN_SNAPPED_BEAT_MS = 2_500
MAX_WINDOWS = 120


@dataclass(frozen=True)
class Sentence:
    start_ms: int
    end_ms: int
    text: str


def plan_coverage(
    model_segments: list[TimelineSegment],
    sentences: list[Sentence],
    requested_ms: int,
) -> list[TimelineSegment]:
    """Return ordered, non-overlapping beats spread over the whole transcript extent."""
    timed = sorted((s for s in sentences if s.end_ms > s.start_ms), key=lambda s: (s.start_ms, s.end_ms))
    extent = max((s.end_ms for s in timed), default=0)
    if extent <= 0 or requested_ms <= 0:
        return model_segments

    windows = _windows(timed, extent, requested_ms)
    total_len = sum(end - start for start, end in windows)
    picks: list[tuple[int, int]] = []
    for start, end in windows:
        quota = (end - start) if requested_ms >= total_len else round(requested_ms * (end - start) / total_len)
        if quota <= 0:
            continue
        picks.append(_pick(start, end, quota, timed, model_segments))

    beats: list[tuple[int, int]] = []
    for start, end in picks:
        beats.extend(_split(start, end, timed))
    return _with_drafts(beats, model_segments, sentences)


def _windows(sentences: list[Sentence], extent: int, requested_ms: int) -> list[tuple[int, int]]:
    count = min(
        math.ceil(extent / WINDOW_TARGET_MS),
        max(1, requested_ms // TARGET_BEAT_MS),
        MAX_WINDOWS,
    )
    count = max(1, count)
    boundaries = [0]
    step = extent / count
    for index in range(1, count):
        raw = round(step * index)
        snapped = _nearest_boundary(raw, sentences, tolerance=round(step / 4))
        if snapped > boundaries[-1] and snapped < extent:
            boundaries.append(snapped)
    boundaries.append(extent)
    return [(a, b) for a, b in zip(boundaries, boundaries[1:]) if b > a]


def _sentence_boundaries(sentences: list[Sentence]) -> list[int]:
    """Cut points between sentences: the middle of the pause, or the shared edge."""
    points = []
    for current, following in zip(sentences, sentences[1:]):
        if following.start_ms >= current.end_ms:
            points.append((current.end_ms + following.start_ms) // 2)
    return points


def _nearest_boundary(target: int, sentences: list[Sentence], *, tolerance: int) -> int:
    best = None
    for point in _sentence_boundaries(sentences):
        if abs(point - target) <= tolerance and (best is None or abs(point - target) < abs(best - target)):
            best = point
    return target if best is None else best


def _pick(
    start: int,
    end: int,
    quota: int,
    sentences: list[Sentence],
    model_segments: list[TimelineSegment],
) -> tuple[int, int]:
    """Choose one contiguous ``quota``-long range inside the window."""
    if quota >= end - start:
        return start, end
    anchor = max(
        (
            (min(end, s.end_ms) - max(start, s.start_ms), max(start, s.start_ms), min(end, s.end_ms))
            for s in model_segments
        ),
        default=None,
    )
    if anchor is not None and anchor[0] > 0:
        # Keep the moment the model matched to its script, centred when it is longer than the quota.
        _, a_start, a_end = anchor
        center = (a_start + a_end) // 2 if a_end - a_start > quota else a_start + quota // 2
        begin = min(max(start, center - quota // 2), end - quota)
        snapped = [s.start_ms for s in sentences
                   if start <= s.start_ms <= end - quota and abs(s.start_ms - begin) <= quota // 4]
        if snapped:
            begin = min(snapped, key=lambda value: abs(value - begin))
        return begin, begin + quota

    # No model choice here: take the stretch with the most speech (sentence starts keep cuts clean).
    candidates = {start} | {min(max(start, s.start_ms), end - quota) for s in sentences if start <= s.start_ms < end}
    return max(
        ((c, c + quota) for c in sorted(candidates)),
        key=lambda rng: (_speech_chars(rng[0], rng[1], sentences), -rng[0]),
    )


def _speech_chars(start: int, end: int, sentences: list[Sentence]) -> float:
    total = 0.0
    for s in sentences:
        overlap = min(end, s.end_ms) - max(start, s.start_ms)
        if overlap > 0:
            total += len(s.text.strip()) * overlap / (s.end_ms - s.start_ms)
    return total


def _split(start: int, end: int, sentences: list[Sentence]) -> list[tuple[int, int]]:
    """Split a pick into ~TARGET_BEAT_MS beats, preferring sentence boundaries."""
    length = end - start
    count = max(1, round(length / TARGET_BEAT_MS))
    while count > 1 and length / count < MIN_BEAT_MS:
        count -= 1
    if count == 1:
        return [(start, end)]
    cuts = [start]
    for index in range(1, count):
        raw = start + round(length * index / count)
        snapped = _nearest_boundary(raw, sentences, tolerance=round(length / count / 3))
        if snapped - cuts[-1] >= MIN_SNAPPED_BEAT_MS and end - snapped >= MIN_SNAPPED_BEAT_MS:
            cuts.append(snapped)
        elif raw - cuts[-1] >= MIN_SNAPPED_BEAT_MS:
            cuts.append(raw)
    cuts.append(end)
    return [(a, b) for a, b in zip(cuts, cuts[1:]) if b > a]


def _with_drafts(
    beats: list[tuple[int, int]],
    model_segments: list[TimelineSegment],
    sentences: list[Sentence],
) -> list[TimelineSegment]:
    """Attach each model excerpt to the beat it overlaps most; other beats get narration written later."""
    drafts: dict[int, list[TimelineSegment]] = {}
    for segment in model_segments:
        overlaps = [min(b_end, segment.end_ms) - max(b_start, segment.start_ms) for b_start, b_end in beats]
        best = max(range(len(beats)), key=lambda i: overlaps[i], default=None)
        if best is not None and overlaps[best] > 0:
            drafts.setdefault(best, []).append(segment)

    result = []
    for index, (start, end) in enumerate(beats):
        donors = drafts.get(index, [])
        refs = [str(i) for i, s in enumerate(sentences) if s.start_ms < end and s.end_ms > start]
        notes = [d.reasoning_note for d in donors if d.reasoning_note]
        result.append(TimelineSegment(
            start_ms=start,
            end_ms=end,
            script_excerpt=" ".join(d.script_excerpt.strip() for d in donors if d.script_excerpt.strip()),
            source_sentence_refs=refs,
            reasoning_note=notes[0] if notes else None,
        ))
    return result
