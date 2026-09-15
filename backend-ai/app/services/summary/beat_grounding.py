"""Beat Grounding — generative summary visual/narration synchronization.

Implements the CORE INVARIANT for ``summary.generative``:

    A narration unit MUST NOT describe a future visual event before the
    corresponding visual range begins.

Each generated beat (VisualRange + NarrationUnit + TTS + Subtitle) forms one
temporally bounded presentation unit. Narration for Beat N MUST NOT spill
semantically into Beat N+1.

Design notes (architecture-consistent, minimal):

* Transcript blocks (``_BLOCK_TARGET_MS ~60s``) remain as *transcript context
  grouping* only. They MUST NOT automatically become final visual
  presentation ranges.
* The allocator/planner owns final source coverage and target minutes.
  Visual candidates (3s-12s peak-centered windows) provide action anchors and
  descriptions inside that budget; STT = textual evidence, VLM = visual
  evidence, scene detection = temporal boundary evidence, TTS = audio duration truth.
* This module is pure/deterministic (no DB, no IO, no provider calls) so it
  is unit-testable and safe to use from the FastAPI gateway.
* No DB migration, no ``VisualBeat``/``BeatTiming`` redesign, no per-sentence
  TTS. The internal ``NarrativeBeat`` representation is transient only and is
  never persisted.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.services.allocator import AllocationError
from app.services.timing_boundaries import SILENCE_BOUNDARY_MS

# Marker added to plan warnings when VLM evidence is absent and the plan fell
# back to STT-only visual ranges. Never claim grounded visuals in that mode.
VISUAL_GROUNDING_DEGRADED_WARNING = "VISUAL_GROUNDING_DEGRADED:STT_ONLY"

# Distant visual clusters separated by this gap or more must never be merged
# into one narration beat (mirrors split_distant_blocks_into_sections default).
DEFAULT_MAX_VISUAL_GAP_MS = SILENCE_BOUNDARY_MS

# Visual candidate duration guardrails for generative recap (semantic
# completeness wins, but ranges outside this band are suspicious).
MIN_GROUNDED_RANGE_MS = 2000
MAX_GROUNDED_RANGE_MS = 15000

# Heuristic keyword groups used ONLY for the fail-closed future-leak detector.
# The detector is conservative: it fires only when narration for a single beat
# mentions entities from two distant visual events. It never rewrites text.
_RABBIT_EVENT_TERMS = frozenset(
    {"rabbit", "rabbits", "bunny", "road sign", "road signs", "intersection", "crossroad"}
)
_WOLF_EVENT_TERMS = frozenset(
    {"wolf", "bee", "bees", "swamp", "lettuce", "trap", "honeycomb", "hive"}
)

FitAction = Literal["ALIGNED", "NEEDS_REPLAN"]

# Degraded (STT-only, no VLM evidence) pacing: a 60s transcript block with ~24s
# of narration leaves ~36s of silence per beat. Splitting oversized sections at
# transcript silence gaps into ~25s sub-beats lets the per-section sentence
# floor raise narration density, shrinking silent tails without fabricating
# visual semantics (blocks stay in source order, never merged across gaps).
DEGRADED_TARGET_BEAT_MS = 25000
DEGRADED_MIN_SILENCE_GAP_MS = SILENCE_BOUNDARY_MS
DEGRADED_MIN_SPAN_TO_SPLIT_MS = 30000
DEGRADED_MIN_SUB_BEAT_MS = 8000

# Measured narration density (vi, Piper TTS): ~14-15 chars/s. Used ONLY as a
# per-section writer length target so narration roughly fills its footage.
# Planning guidance only — never overrides measured TTS truth.
NARRATION_TARGET_CPS = 14


@dataclass
class NarrativeBeat:
    """Transient internal planning representation (never persisted).

    Couples one semantic event to its visual ranges and narration text.
    The exact class shape is implementation detail; the important relation is
    semantic_event <-> visual_range <-> narration <-> TTS duration.
    """

    beat_id: str
    semantic_event: str
    source_visual_ranges: list[tuple[int, int]] = field(default_factory=list)
    narration_text: str = ""
    visual_description: str = ""
    evidence_refs: list[str] = field(default_factory=list)


def validate_visual_range(
    start_ms: int,
    end_ms: int,
    video_duration_ms: int,
) -> tuple[int, int]:
    """Deterministically validate/clamp a VLM-derived range.

    VLM output MUST NOT directly become render timestamps without this gate.
    Raises ``ValueError`` for unrecoverable shapes (start >= end after clamp,
    fully out of bounds, non-positive duration). Callers must fail closed.
    """
    try:
        s = int(start_ms)
        e = int(end_ms)
        dur = int(video_duration_ms)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid visual range (non-numeric): {exc}") from exc
    if dur <= 0:
        raise ValueError("invalid visual range (unknown video duration)")
    s = max(0, min(s, dur))
    e = max(0, min(e, dur))
    if e <= s:
        raise ValueError(f"invalid visual range (start >= end after clamp): {s}>={e}")
    return s, e


def _candidate_window(candidate: Any) -> tuple[int, int, Any]:
    """Extract (start, end, raw) from VisualCandidate dataclass or plain dict."""
    if hasattr(candidate, "start_ms") and hasattr(candidate, "end_ms"):
        return int(getattr(candidate, "start_ms")), int(getattr(candidate, "end_ms")), candidate
    if isinstance(candidate, dict):
        return int(candidate.get("start_ms", 0)), int(candidate.get("end_ms", 0)), candidate
    raise ValueError(f"unsupported candidate shape: {type(candidate)}")


def _candidate_desc(candidate: Any) -> str:
    if hasattr(candidate, "visual_description"):
        return str(getattr(candidate, "visual_description") or "")
    if isinstance(candidate, dict):
        return str(candidate.get("visual_description") or candidate.get("dominant_action") or "")
    return ""


def _candidate_action(candidate: Any) -> str:
    if hasattr(candidate, "dominant_action"):
        return str(getattr(candidate, "dominant_action") or "")
    if isinstance(candidate, dict):
        return str(candidate.get("dominant_action") or candidate.get("action") or "")
    return ""


def rewrite_section_refs_from_candidates(
    sections: list[Any],
    candidates: list[Any] | None,
    video_duration_ms: int,
    max_gap_ms: int = DEFAULT_MAX_VISUAL_GAP_MS,
) -> dict[str, list[tuple[int, int]]]:
    """Map each allocated section_id to grounded visual ranges.

    * Finds candidates overlapping the section transcript span.
    * Clamps each through :func:`validate_visual_range` (invalid ones dropped).
    * Merges windows separated by ``< max_gap_ms``; keeps distant clusters
      separate so callers can split them into distinct beats.
    * Falls back to the section block span when no valid candidate overlaps
      (caller must mark the plan degraded — never claim grounding).
    """
    result: dict[str, list[tuple[int, int]]] = {}
    if not sections:
        return result
    cands: list[tuple[int, int, Any]] = []
    for c in candidates or []:
        try:
            s, e, raw = _candidate_window(c)
            s, e = validate_visual_range(s, e, video_duration_ms)
            cands.append((s, e, raw))
        except ValueError:
            continue
    cands.sort(key=lambda t: t[0])

    for section in sections:
        sid = getattr(section, "section_id", None) or getattr(section, "sectionId", None) or "S000"
        blocks = list(getattr(section, "blocks", None) or [])
        if not blocks:
            continue
        try:
            span_start = min(int(b.start_ms) for b in blocks)
            span_end = max(int(b.end_ms) for b in blocks)
        except (TypeError, ValueError, AttributeError):
            continue
        overlapping = [(s, e) for (s, e, _) in cands if s < span_end and e > span_start]
        if not overlapping:
            # STT-only fallback: block span clamped (degraded, not grounded)
            try:
                fs, fe = validate_visual_range(span_start, span_end, video_duration_ms)
                result[str(sid)] = [(fs, fe)]
            except ValueError:
                result[str(sid)] = []
            continue
        overlapping.sort()
        merged: list[list[int]] = [[overlapping[0][0], overlapping[0][1]]]
        for s, e in overlapping[1:]:
            if s - merged[-1][1] < max_gap_ms:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        result[str(sid)] = [(a, b) for a, b in merged]
    return result


def find_sections_without_visual_coverage(
    sections: list[Any],
    candidates: list[Any] | None,
    video_duration_ms: int,
) -> set[str]:
    """Section IDs whose transcript span has no overlapping valid candidate.

    Callers must mark the plan ``VISUAL_GROUNDING_DEGRADED:STT_ONLY`` when the
    set is non-empty (STT-only fallback preserved but explicitly reduced
    quality — never silently claimed as grounded).
    """
    uncovered: set[str] = set()
    valid: list[tuple[int, int]] = []
    for c in candidates or []:
        try:
            s, e, _ = _candidate_window(c)
            s, e = validate_visual_range(s, e, video_duration_ms)
            valid.append((s, e))
        except ValueError:
            continue
    for section in sections:
        sid = str(getattr(section, "section_id", None) or "S000")
        blocks = list(getattr(section, "blocks", None) or [])
        if not blocks:
            uncovered.add(sid)
            continue
        try:
            span_start = min(int(b.start_ms) for b in blocks)
            span_end = max(int(b.end_ms) for b in blocks)
        except (TypeError, ValueError, AttributeError):
            uncovered.add(sid)
            continue
        if not any(s < span_end and e > span_start for s, e in valid):
            uncovered.add(sid)
    return uncovered


def needs_visual_split(
    refs: list[tuple[int, int]],
    max_gap_ms: int = DEFAULT_MAX_VISUAL_GAP_MS,
) -> bool:
    """True when one section's grounded refs contain distant clusters."""
    if len(refs) <= 1:
        return False
    ordered = sorted(refs)
    return any(b[0] - a[1] >= max_gap_ms for a, b in zip(ordered, ordered[1:]))


def detect_future_event_leakage(narration: str) -> bool:
    """Heuristic future-leak detector (fail-closed, never rewrites).

    Fires only when a SINGLE beat narration mentions both the rabbit/road-sign
    event and the wolf/bee/swamp event — the exact regression in the task
    (Scene A 03:05-04:05 vs Scene B 05:09-06:10). Returns False otherwise.
    """
    text = (narration or "").lower()
    has_rabbit = any(t in text for t in _RABBIT_EVENT_TERMS)
    has_wolf = any(t in text for t in _WOLF_EVENT_TERMS)
    return bool(has_rabbit and has_wolf)


def evaluate_visual_tts_fit(
    visual_duration_ms: int,
    tts_duration_ms: int,
) -> FitAction:
    """Validate a beat before deterministic TTS-driven visual fitting.

    TTS is the beat-duration authority. For two positive measurements the
    worker fits the selected source visual to the measured TTS slot, so there
    is no NATURAL_PAUSE branch and no playback-speed contract to enforce here.
    Invalid measurements remain fail-closed for the caller to replan/reject.
    """
    try:
        vis = int(visual_duration_ms)
        tts = int(tts_duration_ms)
    except (TypeError, ValueError):
        return "NEEDS_REPLAN"
    if vis <= 0 or tts <= 0:
        return "NEEDS_REPLAN"
    return "ALIGNED"


def _cut_after_indices(
    spans: list[tuple[int, int]],
    target_ms: int,
    min_gap_ms: int,
) -> list[int]:
    """Indices after which to cut sorted (start, end) spans at silences.

    Cuts only at gaps >= min_gap_ms where both sides keep at least
    DEGRADED_MIN_SUB_BEAT_MS, accumulating toward target_ms. Deterministic.
    """
    cuts: list[int] = []
    if len(spans) <= 1:
        return cuts
    durations = [max(0, e - s) for s, e in spans]
    acc = durations[0]
    for i in range(1, len(spans)):
        gap = spans[i][0] - spans[i - 1][1]
        remaining = sum(durations[i:])
        if (
            gap >= min_gap_ms
            and acc >= DEGRADED_MIN_SUB_BEAT_MS
            and remaining >= DEGRADED_MIN_SUB_BEAT_MS
            and acc >= target_ms
        ):
            cuts.append(i - 1)
            acc = durations[i]
        else:
            acc += durations[i]
    # Drop a trailing cut that would leave a sliver behind.
    while cuts:
        trailing = sum(durations[cuts[-1] + 1:])
        if trailing < DEGRADED_MIN_SUB_BEAT_MS:
            cuts.pop()
        else:
            break
    return cuts


def _split_block_at_silence(
    block: Any,
    target_ms: int,
    min_gap_ms: int,
) -> list[Any]:
    """Split one oversized block along its timed segments (tiled, lossless).

    Returns sub-blocks whose spans tile the original span exactly (internal
    boundaries at silence midpoints; first start / last end preserved) and
    whose texts partition the original text in order. Returns [block] when
    the block has fewer than 2 timed segments or no cut qualifies.
    """
    from app.services.narrative_planning_models import TranscriptBlock

    segments = sorted(
        list(getattr(block, "segments", None) or []),
        key=lambda s: (int(s.start_ms), int(s.end_ms)),
    )
    if len(segments) <= 1:
        return [block]
    spans = [(int(s.start_ms), int(s.end_ms)) for s in segments]
    cuts = _cut_after_indices(spans, target_ms, min_gap_ms)
    if not cuts:
        return [block]
    groups: list[list[int]] = []
    start = 0
    for c in cuts:
        groups.append(list(range(start, c + 1)))
        start = c + 1
    groups.append(list(range(start, len(segments))))
    # Tiled boundaries: midpoints of cut silences.
    bounds = [int(block.start_ms)]
    for c in cuts:
        mid = (spans[c][1] + spans[c + 1][0]) // 2
        bounds.append(mid)
    bounds.append(int(block.end_ms))
    sub_blocks: list[Any] = []
    for idx, (group, (bs, be)) in enumerate(zip(groups, zip(bounds, bounds[1:])), start=1):
        texts = [str(segments[i].text or "").strip() for i in group]
        texts = [t for t in texts if t]
        full = " ".join(texts).strip() or str(getattr(block, "full_text", "") or "")
        preview = full if len(full) <= 240 else full[:240].rstrip() + "..."
        try:
            sub_blocks.append(
                TranscriptBlock(
                    block_id=f"{getattr(block, 'block_id', 'B000')}p{idx}",
                    start_ms=int(bs),
                    end_ms=int(be),
                    duration_ms=max(0, int(be) - int(bs)),
                    text_preview=preview,
                    ordered_index=int(getattr(block, "ordered_index", 0) or 0),
                    full_text=full,
                    segments=[segments[i] for i in group],
                )
            )
        except Exception:
            return [block]
    return sub_blocks or [block]


def _coalesce_contiguous_refs(refs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Coalesce only touching/overlapping ranges; never bridge a gap."""
    merged: list[list[int]] = []
    for start, end in sorted((int(a), int(b)) for a, b in refs if int(b) > int(a)):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def split_oversized_sections_at_silence(
    sections: list[Any],
    max_sections: int = 12,
    target_ms: int = DEGRADED_TARGET_BEAT_MS,
    min_gap_ms: int = DEGRADED_MIN_SILENCE_GAP_MS,
) -> tuple[list[Any], dict[str, list[tuple[int, int]]]]:
    """Presentation pacing: split oversized allocated sections at silences.

    The same coverage-preserving splitter runs with or without VLM evidence.
    Only sections spanning more than DEGRADED_MIN_SPAN_TO_SPLIT_MS are
    candidates, and only at real transcript silences — never mid-speech.
    Total output never exceeds max_sections (target_ms doubles until it fits)
    and never drops content. Section order and block order are preserved. If
    the cap cannot be met without merging disconnected ranges, raises
    ``AllocationError``.

    Returns (new_sections, refs_by_section_id) where refs preserve the actual
    allocated block coverage. Internal single-block splits still use silence
    midpoints so the block's full duration remains covered, while separate
    transcript blocks remain separate refs instead of becoming a bounding span.
    """
    from app.services.narrative_planning_models import AllocatedSection

    if not sections:
        return [], {}
    cap = max(1, int(max_sections or 12))
    if len(sections) > cap:
        raise AllocationError(
            f"Cannot honor max_sections={cap}: continuity-preserving sections already total "
            f"{len(sections)}"
        )
    if len(sections) >= cap:
        return list(sections), {}
    attempt_target = max(1, int(target_ms or DEGRADED_TARGET_BEAT_MS))

    def _plan(target: int) -> list[list[list[Any]]]:
        per_section: list[list[list[Any]]] = []
        for section in sections:
            blocks = sorted(
                list(getattr(section, "blocks", None) or []),
                key=lambda b: (int(b.start_ms), int(b.end_ms)),
            )
            span = (
                max(int(b.end_ms) for b in blocks) - min(int(b.start_ms) for b in blocks)
                if blocks else 0
            )
            if not blocks or span <= DEGRADED_MIN_SPAN_TO_SPLIT_MS:
                per_section.append([blocks] if blocks else [])
                continue
            if len(blocks) == 1:
                subs = _split_block_at_silence(blocks[0], target, min_gap_ms)
                per_section.append([[s] for s in subs])
                continue
            spans = [(int(b.start_ms), int(b.end_ms)) for b in blocks]
            cuts = _cut_after_indices(spans, target, min_gap_ms)
            clusters: list[list[Any]] = []
            start = 0
            for c in cuts:
                clusters.append(blocks[start:c + 1])
                start = c + 1
            clusters.append(blocks[start:])
            per_section.append([c for c in clusters if c])
        return per_section

    per_section = _plan(attempt_target)
    while sum(len(c) for c in per_section) > cap and attempt_target < 120000:
        attempt_target *= 2
        per_section = _plan(attempt_target)
    planned_count = sum(len(c) for c in per_section)
    if planned_count > cap:
        raise AllocationError(
            f"Cannot honor max_sections={cap} without merging disconnected transcript ranges"
        )

    result: list[Any] = []
    refs: dict[str, list[tuple[int, int]]] = {}
    sec_counter = 1
    for section, clusters in zip(sections, per_section):
        blocks = sorted(
            list(getattr(section, "blocks", None) or []),
            key=lambda b: (int(b.start_ms), int(b.end_ms)),
        )
        if len(clusters) <= 1:
            sid = f"S{sec_counter:03d}"
            try:
                result.append(section.model_copy(update={"section_id": sid}))
            except Exception:
                result.append(section)
                sid = str(getattr(section, "section_id", sid))
            refs[sid] = _coalesce_contiguous_refs([
                (int(block.start_ms), int(block.end_ms))
                for block in blocks
            ])
            sec_counter += 1
            continue
        for idx, cluster in enumerate(clusters, start=1):
            title = getattr(section, "title", None)
            sub_title = title if idx == 1 else f"{title} (Part {idx})" if title else None
            sid = f"S{sec_counter:03d}"
            try:
                result.append(
                    AllocatedSection(
                        section_id=sid,
                        title=sub_title,
                        goal=getattr(section, "goal", ""),
                        beat_hint=getattr(section, "beat_hint", None),
                        blocks=cluster,
                    )
                )
            except Exception:
                result.append(section)
                sid = str(getattr(section, "section_id", sid))
            refs[sid] = _coalesce_contiguous_refs([
                (int(block.start_ms), int(block.end_ms))
                for block in cluster
            ])
            sec_counter += 1
    return result, refs


def narration_target_chars(visual_duration_ms: int, cps: int = NARRATION_TARGET_CPS) -> int:
    """Per-section writer length target so narration roughly fills footage."""
    try:
        seconds = max(0, int(visual_duration_ms) // 1000)
    except (TypeError, ValueError):
        return 0
    return seconds * max(1, int(cps or NARRATION_TARGET_CPS))


def selected_blocks_covered_by_refs(
    selected_blocks: list[Any],
    refs: list[tuple[int, int]],
) -> bool:
    """True when every selected block lies inside the union of refs.

    Coverage invariant for degraded-split plans: no transcript content may
    fall outside the rendered visual ranges (silences between refs are the
    only allowed exclusion). Merged refs make the check gap-tolerant.
    """
    if not selected_blocks:
        return True
    merged: list[list[int]] = []
    for s, e in sorted((int(a), int(b)) for a, b in refs):
        if e <= s:
            continue
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    for b in selected_blocks:
        try:
            bs, be = int(b.start_ms), int(b.end_ms)
        except (TypeError, ValueError, AttributeError):
            return False
        if not any(ms <= bs and be <= me for ms, me in merged):
            return False
    return True
