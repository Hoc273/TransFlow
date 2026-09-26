"""Beat Grounding â€” generative summary visual/narration synchronization.

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

FitAction = Literal["ALIGNED", "NEEDS_REPLAN"]

# Single-plan presentation pacing goal: ~6s per beat (normally 4-9s).
# Splitting is coverage-preserving and boundary-driven (VLM scenes, then
# transcript sentence/silence) â€” never mechanical clock slicing, never merging
# disconnected ranges, never dropping content to satisfy a product count.
SINGLE_PLAN_TARGET_BEAT_MS = 6000
SINGLE_PLAN_MIN_SUB_BEAT_MS = 4000
SINGLE_PLAN_MIN_SPAN_TO_SPLIT_MS = 9000
# Legacy degraded constants retained as aliases for existing tests/callers.
DEGRADED_TARGET_BEAT_MS = SINGLE_PLAN_TARGET_BEAT_MS
DEGRADED_MIN_SILENCE_GAP_MS = SILENCE_BOUNDARY_MS
DEGRADED_MIN_SPAN_TO_SPLIT_MS = SINGLE_PLAN_MIN_SPAN_TO_SPLIT_MS
DEGRADED_MIN_SUB_BEAT_MS = SINGLE_PLAN_MIN_SUB_BEAT_MS

# Measured narration density (vi TTS): ~14-15 chars/s. Used ONLY as a
# per-section writer length target so narration roughly fills its footage.
# Planning guidance only â€” never overrides measured TTS truth.
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
      (caller must mark the plan degraded â€” never claim grounding).
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
    quality â€” never silently claimed as grounded).
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
    scene_boundaries_ms: list[int] | None = None,
) -> list[int]:
    """Indices after which to cut sorted (start, end) spans.

    Boundary preference: VLM scene boundaries first, then transcript
    silence gaps, then ordinary sentence boundaries. Every inter-span boundary
    is a sentence-safe cut point (spans are timed sentences/segments, so cuts
    never land mid-speech); scene cuts are preferred earliest, silence and
    sentence cuts fire once accumulated duration reaches target. Both sides must
    keep at least SINGLE_PLAN_MIN_SUB_BEAT_MS. Deterministic; never merges
    disconnected ranges.
    """
    cuts: list[int] = []
    if len(spans) <= 1:
        return cuts
    boundaries = sorted({int(b) for b in (scene_boundaries_ms or []) if int(b) > 0})
    durations = [max(0, e - s) for s, e in spans]
    acc = durations[0]

    def _hits_scene_boundary(prev_end: int, next_start: int) -> bool:
        return any(prev_end <= b <= next_start for b in boundaries)

    for i in range(1, len(spans)):
        gap = spans[i][0] - spans[i - 1][1]
        remaining = sum(durations[i:])
        if remaining < SINGLE_PLAN_MIN_SUB_BEAT_MS:
            acc += durations[i]
            continue
        if acc < SINGLE_PLAN_MIN_SUB_BEAT_MS:
            acc += durations[i]
            continue
        scene_cut = _hits_scene_boundary(spans[i - 1][1], spans[i][0])
        # Scene boundaries win earliest (preferred); silence/sentence cuts fire
        # once the beat reaches target duration. Ordinary sentence boundaries
        # are always eligible at target â€” "no mechanical clock slicing" means no
        # mid-speech cuts, not "no sentence cuts".
        if scene_cut:
            cuts.append(i - 1)
            acc = durations[i]
        elif acc >= target_ms:
            cuts.append(i - 1)
            acc = durations[i]
        else:
            acc += durations[i]
    # Drop a trailing cut that would leave a sliver behind.
    while cuts:
        trailing = sum(durations[cuts[-1] + 1:])
        if trailing < SINGLE_PLAN_MIN_SUB_BEAT_MS:
            cuts.pop()
        else:
            break
    return cuts


def _split_block_at_silence(
    block: Any,
    target_ms: int,
    min_gap_ms: int,
    scene_boundaries_ms: list[int] | None = None,
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
    cuts = _cut_after_indices(spans, target_ms, min_gap_ms,
                              scene_boundaries_ms=scene_boundaries_ms)
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
    max_sections: int | None = None,
    target_ms: int = SINGLE_PLAN_TARGET_BEAT_MS,
    min_gap_ms: int = DEGRADED_MIN_SILENCE_GAP_MS,
    scene_boundaries_ms: list[int] | None = None,
) -> tuple[list[Any], dict[str, list[tuple[int, int]]]]:
    """Presentation pacing: split allocated sections into final small beats.

    Coverage-preserving: every selected block remains represented in at least one
    final beat; the union/duration of final source refs equals the selected source
    coverage except legitimate overlap coalescing. Never drops content to satisfy
    beat count; an explicit compatibility cap raises AllocationError instead
    of merging disconnected ranges.

    Boundary preference: VLM scene boundaries first, then transcript
    sentence/silence boundaries. Source order preserved; distant clusters never
    merged into one narration unit (Beat N cannot describe Beat N+1 visuals).
    """
    from app.services.narrative_planning_models import AllocatedSection

    if not sections:
        return [], {}
    cap = max(1, int(max_sections)) if max_sections is not None else None
    if cap is not None and len(sections) > cap:
        raise AllocationError(
            f"Cannot honor max_sections={cap}: continuity-preserving sections already total "
            f"{len(sections)}"
        )
    if cap is not None and len(sections) >= cap:
        return list(sections), {}
    attempt_target = max(1, int(target_ms or SINGLE_PLAN_TARGET_BEAT_MS))
    boundaries = sorted({int(b) for b in (scene_boundaries_ms or []) if int(b) > 0})

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
            if not blocks or span <= SINGLE_PLAN_MIN_SPAN_TO_SPLIT_MS:
                per_section.append([blocks] if blocks else [])
                continue
            if len(blocks) == 1:
                subs = _split_block_at_silence(
                    blocks[0], target, min_gap_ms,
                    scene_boundaries_ms=boundaries or None,
                )
                per_section.append([[s] for s in subs])
                continue
            spans = [(int(b.start_ms), int(b.end_ms)) for b in blocks]
            cuts = _cut_after_indices(spans, target, min_gap_ms,
                                      scene_boundaries_ms=boundaries or None)
            clusters: list[list[Any]] = []
            start = 0
            for c in cuts:
                clusters.append(blocks[start:c + 1])
                start = c + 1
            clusters.append(blocks[start:])
            per_section.append([c for c in clusters if c])
        return per_section

    per_section = _plan(attempt_target)
    planned_count = sum(len(c) for c in per_section)
    if cap is not None and planned_count > cap:
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
