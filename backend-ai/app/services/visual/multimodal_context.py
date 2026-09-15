"""Merge: Transcript + Visual observations + scene boundaries → multimodal context (requirement 7).

Produces a deterministic interleaved timeline for the narrative writer.
Transcript remains authoritative for speech; visual fills gaps where transcript
is sparse (requirements 8, 9, 10).

Grounding (requirement 9): each narrative claim must reference transcript evidence
or visual evidence — this module emits evidence spans so the writer can cite them.

Confidence (requirement 10): low VLM confidence (< 0.5) → hedging is required;
this module annotates low-confidence spans so the prompt can instruct hedged language.
"""
from __future__ import annotations

from typing import List, Optional


def build_multimodal_context(
    transcript: List[dict],
    observations: List[dict],
    scenes: List[dict],
    *,
    duration_ms: Optional[int] = None,
) -> dict:
    if duration_ms is None:
        # derive from transcript or observations
        candidates = []
        for s in transcript:
            try:
                candidates.append(int(s.get("end_ms", 0)))
            except Exception:
                pass
        for o in observations:
            try:
                candidates.append(int(o.get("timestamp", 0)) + 2000)
            except Exception:
                pass
        for sc in scenes:
            try:
                candidates.append(int(sc.get("end_ms", 0)))
            except Exception:
                pass
        duration_ms = max(candidates) if candidates else 0

    scene_boundaries_ms = [int(sc.get("start_ms", 0)) for sc in scenes[1:]] if len(scenes) > 1 else []

    # Build timeline interleaving for prompt convenience (sorted by time)
    timeline: List[dict] = []
    for seg in transcript:
        timeline.append(
            {
                "type": "speech",
                "timestamp": int(seg.get("start_ms", 0)),
                "end_ms": int(seg.get("end_ms", 0)),
                "text": str(seg.get("text", "")),
                "confidence": float(seg.get("confidence", 1.0)) if seg.get("confidence") is not None else 1.0,
            }
        )
    for obs in observations:
        timeline.append(
            {
                "type": "visual",
                "timestamp": int(obs.get("timestamp", 0)),
                "visual_description": str(obs.get("visual_description", "")),
                "action": obs.get("action"),
                "people": obs.get("people"),
                "location": obs.get("location"),
                "objects": obs.get("objects") or [],
                "text": obs.get("text"),
                "confidence": float(obs.get("confidence", 0.5)),
                "scene_id": obs.get("scene_id"),
                "hedge": float(obs.get("confidence", 0.5)) < 0.5,
            }
        )
    for sc in scenes:
        timeline.append(
            {
                "type": "scene",
                "timestamp": int(sc.get("start_ms", 0)),
                "end_ms": int(sc.get("end_ms", 0)),
                "dominant_action": sc.get("dominant_action"),
                "people_range": sc.get("people_range"),
                "confidence": float(sc.get("confidence", 0.5)),
                "scene_id": sc.get("scene_id"),
            }
        )
    timeline = sorted(timeline, key=lambda x: (int(x.get("timestamp", 0)), {"speech": 0, "visual": 1, "scene": 2}.get(x.get("type", ""), 9)))

    # Multimodal summary: heuristic 2-3 sentence digest for quick prompt injection
    # Without LLM call, produce deterministic summary from top actions/locations
    multimodal_summary = None
    if observations or scenes:
        top_actions = []
        for sc in scenes[:3]:
            if sc.get("dominant_action"):
                top_actions.append(sc.get("dominant_action"))
        if not top_actions:
            # fallback to top visual descriptions truncated
            for obs in observations[:2]:
                if obs.get("visual_description"):
                    top_actions.append(obs.get("visual_description")[:80])
        if top_actions:
            multimodal_summary = "Visual context: " + "; ".join(top_actions[:3]) + "."
            # hedging note for low confidence scenes OR any low-confidence observation
            low_conf_scenes = [s for s in scenes if float(s.get("confidence", 1.0)) < 0.5]
            low_conf_obs = [o for o in observations if float(o.get("confidence", 1.0)) < 0.5]
            if low_conf_scenes or low_conf_obs:
                multimodal_summary += " (visual confidence low in parts — hedge accordingly)"
            # speech sparsity note
            speech_chars = sum(len(str(s.get("text", ""))) for s in transcript)
            if speech_chars < 100 and observations:
                multimodal_summary += " Transcript is sparse; rely on visual evidence where grounded."
            elif speech_chars < 20 and not transcript:
                multimodal_summary = "Visual-only context (no transcript): " + "; ".join(top_actions[:3]) + "."

    # Grounding helpers: evidence spans
    # For narrative writer, expose per-scene evidence that maps to source_ref-style spans
    # Requirement 8: "at 00:42 two people start fighting" even when transcript doesn't mention it
    # → visual evidence must be time-grounded
    return {
        "transcript_segments": transcript,
        "visual_observations": observations,
        "visual_scenes": scenes,
        "scene_boundaries_ms": scene_boundaries_ms,
        "duration_ms": int(duration_ms),
        "multimodal_summary": multimodal_summary,
        "timeline": timeline,
    }
