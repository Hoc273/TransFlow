"""Temporal grouping: gộp observations gần nhau thành scene/action segment (requirement 6).

Groups raw VisualObservation list (sorted by timestamp) into VisualScene segments.
Heuristics (deterministic, no LLM):
- same sceneId → same scene
- else: time gap <= 5s AND same dominant action/location/people pattern → same scene
- otherwise new scene
- confidence for scene = mean of observation confidences
- dominant_action = most frequent action in scene (tie → earliest)
"""
from __future__ import annotations

from collections import Counter
from typing import List, Optional


def _same_people_pattern(a: int, b: int) -> bool:
    return abs(a - b) <= 1 or (a >= 3 and b >= 3)


def group_observations(
    observations: List[dict],
    *,
    gap_ms: int = 5000,
    min_scene_duration_ms: int = 2000,
) -> List[dict]:
    """Group sorted observations into scenes. Returns list of VisualScene dicts."""
    if not observations:
        return []
    # sort by timestamp
    obs = sorted(observations, key=lambda o: int(o.get("timestamp", 0)))
    scenes: List[List[dict]] = []
    current: List[dict] = [obs[0]]
    for cur in obs[1:]:
        prev = current[-1]
        gap = int(cur.get("timestamp", 0)) - int(prev.get("timestamp", 0))
        # grouping predicate
        cur_sid = cur.get("scene_id")
        prev_sid = prev.get("scene_id")
        both_have_sid = bool(cur_sid and prev_sid)
        same_scene_id = bool(cur_sid and cur_sid == prev_sid)
        diff_scene_id = both_have_sid and cur_sid != prev_sid
        same_action = (cur.get("action") or "").strip().lower() == (prev.get("action") or "").strip().lower()
        same_location = (cur.get("location") or "").strip().lower() == (prev.get("location") or "").strip().lower()
        people_close = _same_people_pattern(int(cur.get("people", 0)), int(prev.get("people", 0)))
        if diff_scene_id:
            scene_continues = False
        else:
            scene_continues = (
                same_scene_id
                or (gap <= gap_ms and (same_action or same_location) and people_close)
                or (gap <= 2000 and people_close)  # very close frames stay together
            )
        if scene_continues:
            current.append(cur)
        else:
            scenes.append(current)
            current = [cur]
    scenes.append(current)

    # optional merge: short scenes (< min duration) merge into neighbor only if temporally close
    merged: List[List[dict]] = []
    for grp in scenes:
        span = int(grp[-1].get("timestamp", 0)) - int(grp[0].get("timestamp", 0))
        if span < min_scene_duration_ms and merged:
            gap_to_prev = int(grp[0].get("timestamp", 0)) - int(merged[-1][-1].get("timestamp", 0))
            if gap_to_prev <= gap_ms and _same_people_pattern(int(grp[0].get("people", 0)), int(merged[-1][-1].get("people", 0))):
                merged[-1].extend(grp)
                continue
        merged.append(grp)
    scenes = merged

    result: List[dict] = []
    for idx, grp in enumerate(scenes, start=1):
        timestamps = [int(o.get("timestamp", 0)) for o in grp]
        start_ms = min(timestamps)
        end_ms = max(timestamps)
        # approximate end = last observation timestamp + half gap or 2000ms
        # For display, extend end by half interval to cover until next scene
        # but keep at least 1s window
        # Use 3000ms default scene width if single observation
        if len(grp) == 1:
            end_ms = start_ms + 3000
        else:
            # estimate scene end as last timestamp + avg gap
            if len(timestamps) >= 2:
                gaps = [timestamps[i + 1] - timestamps[i] for i in range(len(timestamps) - 1)]
                avg_gap = sum(gaps) // len(gaps) if gaps else 2000
                end_ms = max(end_ms, timestamps[-1] + avg_gap // 2)
        actions = [str(o.get("action") or "").strip() for o in grp if (o.get("action") or "").strip()]
        locations = [str(o.get("location") or "").strip() for o in grp if (o.get("location") or "").strip()]
        dominant_action = Counter(actions).most_common(1)[0][0] if actions else None
        dominant_location = Counter(locations).most_common(1)[0][0] if locations else None
        people_vals = [int(o.get("people", 0)) for o in grp]
        people_range = f"{min(people_vals)}-{max(people_vals)}" if min(people_vals) != max(people_vals) else str(people_vals[0])
        confidences = [float(o.get("confidence", 0.5)) for o in grp]
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.5
        # if any supplied scene_id consistent, use it; else generate
        supplied_ids = {o.get("scene_id") for o in grp if o.get("scene_id")}
        scene_id = next(iter(supplied_ids)) if len(supplied_ids) == 1 else f"scene-{idx:03d}"
        # grounding note
        evidence_note = None
        if dominant_action:
            evidence_note = f"visual evidence scene {scene_id}: {dominant_action} at {start_ms//1000:02d}:{(start_ms%60000)//1000:02d} ({len(grp)} obs)"
        result.append(
            {
                "scene_id": scene_id,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "dominant_action": dominant_action,
                "dominant_location": dominant_location,
                "people_range": people_range,
                "observations": grp,
                "confidence": round(avg_conf, 3),
                "evidence_note": evidence_note,
            }
        )
    return result


def detect_scene_changes(observations: List[dict]) -> List[int]:
    """Return sorted list of scene boundary timestamps (start_ms of each scene after first)."""
    scenes = group_observations(observations)
    if len(scenes) <= 1:
        return []
    return [s["start_ms"] for s in scenes[1:]]
