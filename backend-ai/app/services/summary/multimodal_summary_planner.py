"""M17.2 — Multimodal Summary Planner.

Implements:
- M17.2-B: Action-aware scene importance scoring
- M17.2-C: Temporal selection fitting summary budget
- M17.2-D: Narrative grounding against visual and transcript evidence
"""
import re
import uuid
from typing import Optional

from app.schemas.summary_plan_contract import (
    SceneImportanceScore,
    SummaryScenePlan,
    SummaryPlan,
)
from app.services.timing_boundaries import SILENCE_BOUNDARY_MS

# Action keywords that signify high visual storytelling importance
ACTION_KEYWORDS = {
    "fight": 0.95,
    "punch": 0.95,
    "kick": 0.90,
    "flip": 0.90,
    "jump": 0.85,
    "sprint": 0.85,
    "run": 0.80,
    "fall": 0.85,
    "slide": 0.80,
    "chase": 0.90,
    "confrontation": 0.85,
    "gesture": 0.65,
    "moving": 0.60,
    "dance": 0.80,
    "action": 0.75,
}

UNSUPPORTED_RISK_TERMS = ["gun", "knife", "sword", "rifle", "pistol", "grenade", "blood", "killed"]


def compute_scene_importance(
    scene: dict,
    observations: list[dict],
    is_sparse_transcript: bool = False,
) -> SceneImportanceScore:
    """Calculate scene importance score (M17.2-B).

    If transcript is sparse, action intensity dominates the score.
    """
    obs_in_scene = [
        o for o in observations
        if int(o.get("timestamp", 0)) >= int(scene.get("start_ms", 0))
        and int(o.get("timestamp", 0)) <= int(scene.get("end_ms", 0))
    ] or [scene]

    # 1. Action intensity
    max_action_intensity = 0.2  # baseline
    for o in obs_in_scene:
        text = ((o.get("action") or "") + " " + (o.get("visual_description") or "")).lower()
        for kw, score in ACTION_KEYWORDS.items():
            if kw in text:
                max_action_intensity = max(max_action_intensity, score)

    # 2. Visual novelty: high confidence and multiple distinct objects/location
    confidence = float(scene.get("confidence", 0.7) or 0.7)
    visual_novelty = min(1.0, 0.5 + 0.1 * len(scene.get("dominant_location") or "") + 0.3 * confidence)

    # 3. Narrative relevance: position in story (opening hook, climax, resolution)
    narrative_relevance = 0.7  # default

    # 4. Transcript relevance: dialogue present
    transcript_relevance = 0.8 if not is_sparse_transcript else 0.1

    # Composite weighted score
    if is_sparse_transcript:
        # Visual action dominates completely (75% action, 15% novelty, 10% transcript)
        composite = (
            0.75 * max_action_intensity
            + 0.15 * visual_novelty
            + 0.10 * transcript_relevance
        )
    else:
        # Balanced multimodal
        composite = (
            0.45 * max_action_intensity
            + 0.25 * visual_novelty
            + 0.30 * transcript_relevance
        )

    composite = round(min(1.0, max(0.0, composite)), 3)

    return SceneImportanceScore(
        action_intensity=round(max_action_intensity, 2),
        visual_novelty=round(visual_novelty, 2),
        narrative_relevance=round(narrative_relevance, 2),
        transcript_relevance=round(transcript_relevance, 2),
        composite_score=composite,
    )


def select_temporal_ranges(
    scenes: list[dict],
    target_duration_ms: int,
    min_scene_duration_ms: int = 2000,
    max_scene_duration_ms: int = 15000,
) -> list[dict]:
    """Select and budget temporal ranges from candidate scenes (M17.2-C)."""
    if not scenes:
        return []

    # Sort scenes by composite score descending
    sorted_scenes = sorted(
        scenes,
        key=lambda s: s.get("_importance_score", 0.5),
        reverse=True,
    )

    selected: list[dict] = []
    budget_used = 0

    for sc in sorted_scenes:
        raw_dur = max(min_scene_duration_ms, int(sc.get("end_ms", 0)) - int(sc.get("start_ms", 0)))
        scene_dur = min(raw_dur, max_scene_duration_ms)

        if budget_used + scene_dur <= target_duration_ms:
            sc_copy = dict(sc)
            sc_copy["end_ms"] = int(sc_copy.get("start_ms", 0)) + scene_dur
            selected.append(sc_copy)
            budget_used += scene_dur
        elif budget_used + min_scene_duration_ms <= target_duration_ms:
            # allocate remaining budget
            remaining = target_duration_ms - budget_used
            sc_copy = dict(sc)
            sc_copy["end_ms"] = int(sc_copy.get("start_ms", 0)) + remaining
            selected.append(sc_copy)
            budget_used += remaining
            break
        else:
            # No budget left for another scene
            break

    # If nothing fit, take the top scene clamped
    if not selected and sorted_scenes:
        top = dict(sorted_scenes[0])
        dur = min(target_duration_ms, max_scene_duration_ms)
        top["end_ms"] = int(top.get("start_ms", 0)) + dur
        selected.append(top)

    # Sort selected scenes chronologically
    selected = sorted(selected, key=lambda s: int(s.get("start_ms", 0)))

    # Merge nearby ranges (< silence boundary) without exceeding budget.
    merged: list[dict] = []
    for s in selected:
        if not merged:
            merged.append(s)
        else:
            prev = merged[-1]
            gap = int(s.get("start_ms", 0)) - int(prev.get("end_ms", 0))
            if 0 <= gap < SILENCE_BOUNDARY_MS:
                prev["end_ms"] = max(int(prev.get("end_ms", 0)), int(s.get("end_ms", 0)))
                prev_ev = prev.get("_evidence_refs", [])
                curr_ev = s.get("_evidence_refs", [])
                prev["_evidence_refs"] = list(dict.fromkeys(prev_ev + curr_ev))
            else:
                merged.append(s)

    return merged


def ground_narrative_to_evidence(
    raw_narration: str,
    observations: list[dict],
    transcript: list[dict],
) -> tuple[str, list[str]]:
    """Enforce narrative grounding (M17.2-D).

    Rejects hallucinated weapons/injuries when not supported by visual or transcript evidence.
    Returns (sanitized_narration, unsupported_claims).
    """
    unsupported = []
    all_evidence_text = " ".join(
        [str(o.get("visual_description", "")) + " " + str(o.get("action", "")) for o in observations]
        + [str(t.get("text", "")) for t in transcript]
    ).lower()

    sanitized = raw_narration
    for term in UNSUPPORTED_RISK_TERMS:
        if re.search(rf"\b{term}\b", sanitized, re.IGNORECASE):
            if term not in all_evidence_text:
                unsupported.append(f"unsupported claim: '{term}' not present in source footage")
                sanitized = re.sub(rf"\b{term}\b", "", sanitized, flags=re.IGNORECASE)

    sanitized = re.sub(r"\s+", " ", sanitized).strip()
    return sanitized, unsupported


def build_summary_plan(
    multimodal_context: dict,
    target_duration_ms: int = 30000,
    objective: str = "action summary",
    visual_strategy: str = "SOURCE_CLIP",
) -> SummaryPlan:
    """End-to-end multimodal summary planning (M17.2-A..D)."""
    transcript = multimodal_context.get("transcript_segments", []) or []
    observations = multimodal_context.get("visual_observations", []) or []
    scenes = multimodal_context.get("visual_scenes", []) or []

    total_transcript_words = sum(len(str(t.get("text", "")).split()) for t in transcript)
    duration_ms = int(multimodal_context.get("duration_ms", 120000) or 120000)
    duration_min = max(0.5, duration_ms / 60000.0)
    words_per_minute = total_transcript_words / duration_min
    is_sparse = words_per_minute < 10.0

    if not scenes and observations:
        scenes = [{
            "scene_id": "scene-001",
            "start_ms": min(int(o.get("timestamp", 0)) for o in observations),
            "end_ms": max(int(o.get("timestamp", 0)) for o in observations) + 2000,
            "dominant_action": observations[0].get("action", "action"),
            "confidence": observations[0].get("confidence", 0.8),
        }]
    elif not scenes and not observations:
        scenes = [{
            "scene_id": "scene-001",
            "start_ms": 0,
            "end_ms": min(target_duration_ms, duration_ms),
            "dominant_action": "dialogue",
            "confidence": 0.8,
        }]

    scored_scenes = []
    for sc in scenes:
        sc_copy = dict(sc)
        score = compute_scene_importance(sc, observations, is_sparse_transcript=is_sparse)
        sc_copy["_importance_score"] = score.composite_score
        sc_copy["_action_intensity"] = score.action_intensity
        sc_start = int(sc.get("start_ms", 0))
        sc_end = int(sc.get("end_ms", 0))
        evidence_refs = [
            f"obs-{o.get('timestamp')}"
            for o in observations
            if sc_start <= int(o.get("timestamp", 0)) <= sc_end
        ]
        sc_copy["_evidence_refs"] = evidence_refs
        scored_scenes.append(sc_copy)

    selected_ranges = select_temporal_ranges(
        scored_scenes,
        target_duration_ms=target_duration_ms,
    )

    summary_scenes: list[SummaryScenePlan] = []
    cursor_ms = 0
    all_unsupported: list[str] = []

    for idx, r in enumerate(selected_ranges):
        src_start = int(r.get("start_ms", 0))
        src_end = int(r.get("end_ms", 0))
        scene_dur = src_end - src_start
        sum_start = cursor_ms
        sum_end = cursor_ms + scene_dur
        cursor_ms = sum_end

        action_desc = r.get("dominant_action") or "Key action unfolds"
        raw_narration = f"Scene {idx+1}: {action_desc}."
        narration, unsupp = ground_narrative_to_evidence(raw_narration, observations, transcript)
        all_unsupported.extend(unsupp)

        confidence = float(r.get("confidence", 0.8) or 0.8)
        importance = float(r.get("_importance_score", 0.7) or 0.7)

        summary_scenes.append(
            SummaryScenePlan(
                scene_id=f"summary-scene-{idx+1:03d}",
                source_start_ms=src_start,
                source_end_ms=src_end,
                summary_start_ms=sum_start,
                summary_end_ms=sum_end,
                narration_text=narration,
                visual_strategy=visual_strategy,
                visual_evidence_refs=r.get("_evidence_refs", []),
                transition="cut" if idx == 0 else "crossfade",
                audio_mode="VOICEOVER",
                confidence=confidence,
                importance=importance,
                unsupported_claims=unsupp,
            )
        )

    total_summary_duration = cursor_ms or target_duration_ms
    avg_conf = sum(s.confidence for s in summary_scenes) / len(summary_scenes) if summary_scenes else 0.8
    action_ratio = 0.85 if is_sparse else 0.40

    return SummaryPlan(
        plan_id=f"plan-{uuid.uuid4().hex[:8]}",
        target_duration_ms=target_duration_ms,
        total_summary_duration_ms=total_summary_duration,
        summary_objective=objective,
        scenes=summary_scenes,
        overall_confidence=round(avg_conf, 2),
        visual_action_ratio=action_ratio,
        unsupported_claims=all_unsupported,
    )
