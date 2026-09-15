"""Visual Candidate Planner (Generative Summary Visual-TTS Alignment).

Solves the visual desynchronization problem where voice/subtitles finish (3–7s),
but video footage has not yet reached the visual action described by narration.

Responsibilities:
1. Generate fine-grained 3s–12s visual candidate windows (never 60s blocks).
2. Action Peak Centering: Center the candidate window on the action peak timestamp T_peak.
3. Multimodal Scoring: When speech is sparse (<10 wpm), visual action intensity dominates
   with 75% weight.
4. Fallback Candidate Generation: If visual observations are unavailable or VLM is disabled,
   slice video or transcript anchors into fine-grained 5s–10s candidate intervals.
5. Provide helper mapping to allocate visual candidates to narrative sections.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, List, Optional

from app.services.summary.multimodal_summary_planner import (
    ACTION_KEYWORDS,
    compute_scene_importance,
)
from app.services.summary.beat_grounding import (
    DEFAULT_MAX_VISUAL_GAP_MS,
    validate_visual_range,
)


@dataclass
class VisualCandidate:
    candidate_id: str
    start_ms: int
    end_ms: int
    duration_ms: int
    peak_timestamp_ms: int
    action_intensity: float = 0.5
    visual_description: str = ""
    dominant_action: str = ""
    importance_score: float = 0.5
    evidence_refs: list[str] = field(default_factory=list)


def center_window_around_peak(
    peak_ms: int,
    target_duration_ms: int,
    video_duration_ms: int,
    min_start_ms: int = 0,
) -> tuple[int, int]:
    """Center a candidate temporal window around peak action timestamp T_peak.

    Returns (start_ms, end_ms) clamped strictly within [0, video_duration_ms].
    """
    if video_duration_ms <= 0:
        video_duration_ms = max(peak_ms + target_duration_ms, target_duration_ms)

    target_dur = min(target_duration_ms, video_duration_ms)
    half_dur = target_dur // 2

    start = peak_ms - half_dur
    end = start + target_dur

    # Left clamp
    if start < min_start_ms:
        start = min_start_ms
        end = min(video_duration_ms, start + target_dur)

    # Right clamp
    if end > video_duration_ms:
        end = video_duration_ms
        start = max(min_start_ms, end - target_dur)

    return int(start), int(end)


def _detect_action_intensity(text: str) -> float:
    lowered = (text or "").lower()
    intensity = 0.2
    for kw, score in ACTION_KEYWORDS.items():
        if re.search(rf"\b{re.escape(kw)}\b", lowered):
            intensity = max(intensity, score)
    return intensity


def generate_visual_candidates(
    visual_observations: list[dict] | None = None,
    visual_scenes: list[dict] | None = None,
    video_duration_ms: int = 120000,
    transcript_segments: list[dict] | None = None,
    target_candidate_duration_ms: int = 5000,
    min_duration_ms: int = 3000,
    max_duration_ms: int = 12000,
) -> list[VisualCandidate]:
    """Generate fine-grained, action-aligned visual candidates.

    When observations/scenes exist, candidates are centered on action peaks.
    When dialogue is sparse (<10 wpm), action intensity dominates scoring (75%).
    When VLM observations are absent, falls back to 5s–10s fine-grained chunks.
    """
    candidates: list[VisualCandidate] = []

    obs_list = visual_observations or []
    scenes_list = visual_scenes or []
    transcript = transcript_segments or []

    # Calculate speech sparsity
    total_words = sum(len(str(t.get("text", "")).split()) for t in transcript)
    dur_min = max(0.5, video_duration_ms / 60000.0)
    words_per_minute = total_words / dur_min
    is_sparse = words_per_minute < 10.0

    if obs_list or scenes_list:
        if scenes_list:
            for idx, sc in enumerate(scenes_list, start=1):
                sc_start = int(sc.get("start_ms", 0))
                sc_end = int(sc.get("end_ms", 0))
                sc_dur = max(0, sc_end - sc_start)

                in_scene_obs = [
                    o for o in obs_list
                    if sc_start <= int(o.get("timestamp", 0)) <= sc_end
                ]

                if in_scene_obs:
                    best_obs = max(
                        in_scene_obs,
                        key=lambda o: _detect_action_intensity(
                            (o.get("action") or "") + " " + (o.get("visual_description") or "")
                        ),
                    )
                    peak_ts = int(best_obs.get("timestamp", sc_start))
                    action_text = (best_obs.get("action") or "") + " " + (best_obs.get("visual_description") or "")
                    visual_desc = best_obs.get("visual_description") or sc.get("dominant_action") or ""
                    dom_action = best_obs.get("action") or sc.get("dominant_action") or ""
                else:
                    peak_ts = sc_start + sc_dur // 2
                    visual_desc = sc.get("dominant_action") or f"Scene {idx}"
                    dom_action = sc.get("dominant_action") or "scene action"

                desired_dur = min(max(target_candidate_duration_ms, min_duration_ms), max_duration_ms)
                scene_target_dur = min(desired_dur, sc_dur) if sc_dur > 0 else desired_dur
                c_start, c_end = center_window_around_peak(
                    peak_ts,
                    scene_target_dur,
                    video_duration_ms=sc_end if sc_end > sc_start else video_duration_ms,
                    min_start_ms=sc_start if sc_end > sc_start else 0,
                )

                score = compute_scene_importance(sc, obs_list, is_sparse_transcript=is_sparse)
                evidence = [f"obs-{o.get('timestamp')}" for o in in_scene_obs]

                candidates.append(
                    VisualCandidate(
                        candidate_id=f"VC{idx:03d}",
                        start_ms=c_start,
                        end_ms=c_end,
                        duration_ms=c_end - c_start,
                        peak_timestamp_ms=peak_ts,
                        action_intensity=score.action_intensity,
                        visual_description=visual_desc,
                        dominant_action=dom_action,
                        importance_score=score.composite_score,
                        evidence_refs=evidence,
                    )
                )
        else:
            sorted_obs = sorted(obs_list, key=lambda o: int(o.get("timestamp", 0)))
            clusters: list[list[dict]] = []
            curr: list[dict] = []
            for o in sorted_obs:
                if not curr:
                    curr.append(o)
                else:
                    if int(o.get("timestamp", 0)) - int(curr[-1].get("timestamp", 0)) <= 8000:
                        curr.append(o)
                    else:
                        clusters.append(curr)
                        curr = [o]
            if curr:
                clusters.append(curr)

            for idx, cluster in enumerate(clusters, start=1):
                best_obs = max(
                    cluster,
                    key=lambda o: _detect_action_intensity(
                        (o.get("action") or "") + " " + (o.get("visual_description") or "")
                    ),
                )
                peak_ts = int(best_obs.get("timestamp", 0))

                desired_dur = min(max(target_candidate_duration_ms, min_duration_ms), max_duration_ms)
                c_start, c_end = center_window_around_peak(
                    peak_ts, desired_dur, video_duration_ms, min_start_ms=0
                )
                fake_scene = {
                    "start_ms": c_start,
                    "end_ms": c_end,
                    "dominant_action": best_obs.get("action") or "action",
                    "confidence": best_obs.get("confidence", 0.8),
                }
                score = compute_scene_importance(fake_scene, cluster, is_sparse_transcript=is_sparse)
                evidence = [f"obs-{o.get('timestamp')}" for o in cluster]

                candidates.append(
                    VisualCandidate(
                        candidate_id=f"VC{idx:03d}",
                        start_ms=c_start,
                        end_ms=c_end,
                        duration_ms=c_end - c_start,
                        peak_timestamp_ms=peak_ts,
                        action_intensity=score.action_intensity,
                        visual_description=best_obs.get("visual_description") or best_obs.get("action") or "",
                        dominant_action=best_obs.get("action") or "action",
                        importance_score=score.composite_score,
                        evidence_refs=evidence,
                    )
                )

    if not candidates:
        if transcript:
            cursor = 0
            idx = 1
            for seg in transcript:
                s_start = int(seg.get("start_ms", 0))
                s_end = int(seg.get("end_ms", 0))
                if s_start >= cursor:
                    c_dur = min(max(s_end - s_start, min_duration_ms), max_duration_ms)
                    c_end = min(video_duration_ms, s_start + c_dur)
                    candidates.append(
                        VisualCandidate(
                            candidate_id=f"VC{idx:03d}",
                            start_ms=s_start,
                            end_ms=c_end,
                            duration_ms=c_end - s_start,
                            peak_timestamp_ms=s_start + (c_end - s_start) // 2,
                            action_intensity=0.4,
                            visual_description=seg.get("text", "")[:80],
                            dominant_action="dialogue",
                            importance_score=0.5,
                            evidence_refs=[],
                        )
                    )
                    cursor = c_end
                    idx += 1
        else:
            step = min(max(target_candidate_duration_ms, min_duration_ms), max_duration_ms)
            idx = 1
            for t in range(0, video_duration_ms, step):
                c_start = t
                c_end = min(video_duration_ms, t + step)
                if c_end > c_start:
                    candidates.append(
                        VisualCandidate(
                            candidate_id=f"VC{idx:03d}",
                            start_ms=c_start,
                            end_ms=c_end,
                            duration_ms=c_end - c_start,
                            peak_timestamp_ms=c_start + (c_end - c_start) // 2,
                            action_intensity=0.3,
                            visual_description=f"Footage at {c_start//1000}s",
                            dominant_action="footage",
                            importance_score=0.5,
                            evidence_refs=[],
                        )
                    )
                    idx += 1

    return candidates


def align_visual_candidates_to_sections(
    candidates: list[VisualCandidate],
    target_section_count: int,
    target_duration_ms: int = 30000,
) -> list[VisualCandidate]:
    """Select visual anchors for the already-budgeted narrative sections.

    ``target_duration_ms`` controls how many fine-grained anchors are useful,
    but it is not a source-coverage allocator. The allocator owns the final
    source refs; candidates only ground action/description inside that budget.
    Maintaining this distinction prevents ``N * 5s`` VLM windows from
    replacing a five-minute allocation.
    """
    if not candidates:
        return []

    count = max(1, min(len(candidates), target_section_count))
    if target_duration_ms and target_duration_ms > 0:
        durations = sorted(max(1, int(c.duration_ms)) for c in candidates)
        median_duration = durations[len(durations) // 2]
        budget_count = max(1, (int(target_duration_ms) + median_duration - 1) // median_duration)
        count = min(count, budget_count)

    if len(candidates) > count:
        top_candidates = sorted(candidates, key=lambda c: c.importance_score, reverse=True)[:count]
        selected = sorted(top_candidates, key=lambda c: c.start_ms)
    else:
        selected = sorted(candidates, key=lambda c: c.start_ms)

    return selected


def validate_candidate_range(
    candidate: VisualCandidate,
    video_duration_ms: int,
) -> tuple[int, int]:
    """Fail-closed gate: a VLM-derived candidate MUST pass deterministic
    validation before it can become a render range. Invalid timestamps can
    never directly become final ranges (TC-GROUND-10)."""
    return validate_visual_range(candidate.start_ms, candidate.end_ms, video_duration_ms)


def split_sections_by_visual_gap(
    sections: list[Any],
    candidates: list[VisualCandidate] | None,
    video_duration_ms: int,
    max_gap_ms: int = DEFAULT_MAX_VISUAL_GAP_MS,
) -> list[Any]:
    """Split allocated sections whose grounded visual clusters are distant.

    Transcript-gap splitting (``split_distant_blocks_into_sections``) is not
    sufficient: one section may cover two temporally disconnected visual
    events (Scene A 03:05-04:05 vs Scene B 05:09-06:10). When the section's
    overlapping visual candidates form clusters separated by ``> max_gap_ms``,
    the section is divided into one sub-section per cluster so narration and
    visual stay coupled (Beat 3A = A, Beat 3B = B). Transcript blocks are
    partitioned to the nearest visual cluster; a single wide block spanning
    both clusters is shared as context (visual refs stay isolated).
    """
    from app.services.narrative_planning_models import AllocatedSection

    if not sections or not candidates:
        return list(sections)
    try:
        from app.services.summary.beat_grounding import rewrite_section_refs_from_candidates

        refs_by_id = rewrite_section_refs_from_candidates(
            sections, candidates, video_duration_ms, max_gap_ms=max_gap_ms
        )
    except Exception:
        return list(sections)

    result: list[Any] = []
    sec_counter = 1
    for section in sections:
        sid = str(getattr(section, "section_id", ""))
        refs = refs_by_id.get(sid, [])
        if len(refs) <= 1:
            try:
                result.append(section.model_copy(update={"section_id": f"S{sec_counter:03d}"}))
            except Exception:
                result.append(section)
            sec_counter += 1
            continue
        # Distant visual clusters -> one sub-section per cluster.
        blocks = list(getattr(section, "blocks", []) or [])
        clusters: list[list[tuple[int, int]]] = [[refs[0]]]
        for r in refs[1:]:
            if r[0] - clusters[-1][-1][1] <= max_gap_ms:
                clusters[-1].append(r)
            else:
                clusters.append([r])
        if len(clusters) <= 1:
            try:
                result.append(section.model_copy(update={"section_id": f"S{sec_counter:03d}"}))
            except Exception:
                result.append(section)
            sec_counter += 1
            continue
        for idx, cluster in enumerate(clusters, start=1):
            c_start = min(s for s, _ in cluster)
            c_end = max(e for _, e in cluster)
            owned = [
                b for b in blocks
                if int(getattr(b, "start_ms", 0)) < c_end and int(getattr(b, "end_ms", 0)) > c_start
            ] or blocks
            title = getattr(section, "title", None)
            sub_title = title if idx == 1 else f"{title} (Part {idx})" if title else None
            try:
                result.append(
                    AllocatedSection(
                        section_id=f"S{sec_counter:03d}",
                        title=sub_title,
                        goal=getattr(section, "goal", ""),
                        beat_hint=getattr(section, "beat_hint", None),
                        blocks=owned,
                    )
                )
            except Exception:
                result.append(section)
            sec_counter += 1
    return result
