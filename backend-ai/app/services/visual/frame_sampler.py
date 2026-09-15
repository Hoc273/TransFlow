"""Frame sampling strategy (requirement 1).

- scene-change aware if possible (uses ffprobe scene score when available)
- sampling interval configurable, max frames, budget check
- never sends entire video to VLM — capped sampling
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class SceneBoundary:
    timestamp_ms: int
    score: float  # 0..1 scene change score


def _estimate_duration_ms(transcript: list[dict], video_duration_ms: Optional[int]) -> int:
    if video_duration_ms is not None and video_duration_ms > 0:
        return int(video_duration_ms)
    if transcript:
        # use last segment end
        try:
            return max(int(s.get("end_ms", 0)) for s in transcript)
        except Exception:
            pass
    return 0


def sample_timestamps(
    *,
    duration_ms: int,
    interval_ms: int = 3000,
    max_frames: int = 12,
    scene_boundaries: Optional[List[SceneBoundary]] = None,
    scene_aware: bool = True,
    scene_threshold: float = 0.3,
) -> List[int]:
    """Return sorted list of frame timestamps (ms) to sample.

    Strategy:
    - When scene_aware and scene_boundaries provided: prioritize scene change points
      (+0.5s after cut) plus uniform fill to hit max_frames without exceeding interval.
    - Otherwise uniform sampling at interval_ms, capped at max_frames.
    - Always includes 0 and near-end (duration - 500ms) when duration > 0 if budget allows.
    - Never exceeds max_frames; uniform step expands when needed.
    """
    if duration_ms <= 0:
        return []
    if interval_ms <= 0:
        interval_ms = 3000
    if max_frames <= 0:
        max_frames = 12

    # Uniform baseline
    # Compute ideal uniform count
    ideal_uniform = max(1, (duration_ms + interval_ms - 1) // interval_ms)
    if ideal_uniform > max_frames:
        # expand interval to fit max_frames
        interval_ms = max(interval_ms, (duration_ms + max_frames - 1) // max_frames)
        ideal_uniform = max(1, (duration_ms + interval_ms - 1) // interval_ms)
        # clamp to max_frames
        if ideal_uniform > max_frames:
            ideal_uniform = max_frames

    uniform = [i * interval_ms for i in range(ideal_uniform)]
    # clamp last < duration
    uniform = [t for t in uniform if t < duration_ms]
    # ensure at least one sample
    if not uniform:
        uniform = [0]
    # ensure last near-end included if sparse
    if duration_ms > 2000 and uniform[-1] < duration_ms - 500:
        # replace last or append if budget allows
        if len(uniform) < max_frames:
            uniform.append(min(duration_ms - 500, uniform[-1] + interval_ms))
        else:
            uniform[-1] = min(duration_ms - 500, duration_ms - 1)

    if not scene_aware or not scene_boundaries:
        # deduplicate + sort + cap
        uniform = sorted(set(uniform))
        return uniform[:max_frames]

    # Scene-aware: collect candidates near scene cuts
    scene_points: List[int] = []
    for b in scene_boundaries:
        if b.score >= scene_threshold:
            # 500ms after cut captures new scene
            t = min(duration_ms - 1, b.timestamp_ms + 500)
            if 0 <= t < duration_ms:
                scene_points.append(t)
    scene_points = sorted(set(scene_points))

    # Merge scene points with uniform, prefer scene points where they replace nearby uniform samples
    # Simple greedy: start with scene_points, fill gaps with uniform points that are >= min_distance from existing
    min_distance = max(800, interval_ms // 2)  # at least 0.8s apart

    merged: List[int] = []
    for t in sorted(set(scene_points + uniform)):
        if not merged or t - merged[-1] >= min_distance:
            merged.append(t)
        # if too close, keep the earlier (scene point already sorted earlier when tied via scene_points first)
    merged = sorted(set(merged))

    # If merged > max_frames, keep scene points first, then most spread uniform
    if len(merged) > max_frames:
        # keep all scene_points that fit, then fill remaining with uniform spaced
        keep = sorted(set(scene_points))[:max_frames]
        remaining = max_frames - len(keep)
        if remaining > 0:
            # pick uniform points most distant from keep
            candidates = [u for u in uniform if u not in keep]

            def distance_to_keep(u: int) -> int:
                return min(abs(u - k) for k in keep) if keep else u

            candidates.sort(key=distance_to_keep, reverse=True)
            keep.extend(candidates[:remaining])
        merged = sorted(set(keep))
        # if still not enough (scene_points < max_frames and candidates exhausted), fall back to uniform cap
        if len(merged) < max_frames:
            extra = [u for u in uniform if u not in merged]
            merged.extend(extra[: max_frames - len(merged)])
            merged = sorted(merged)

    # ensure sorted and within duration
    merged = [t for t in merged if 0 <= t < duration_ms]
    merged = sorted(set(merged))
    return merged[:max_frames]


def sample_dense_around_peak(
    peak_ms: int,
    *,
    window_ms: int = 6000,
    step_ms: int = 1500,
    video_duration_ms: int,
    max_frames: int = 5,
) -> List[int]:
    """Fine pass: densely sample around an action peak T_peak.

    Coarse pass (``sample_timestamps``) finds candidate scenes; this fine pass
    localizes action start/peak/end within one candidate window. Always clamped
    to ``[0, video_duration_ms)`` and capped at ``max_frames``. Pure function.
    """
    if video_duration_ms <= 0:
        return []
    if window_ms <= 0:
        window_ms = 6000
    if step_ms <= 0:
        step_ms = 1500
    if max_frames <= 0:
        max_frames = 5
    try:
        peak = int(peak_ms)
    except (TypeError, ValueError):
        return []
    half = window_ms // 2
    start = max(0, peak - half)
    end = min(int(video_duration_ms), peak + half)
    if end <= start:
        return []
    stamps: List[int] = []
    t = start
    while t < end and len(stamps) < max_frames:
        stamps.append(int(t))
        t += step_ms
    if not stamps:
        stamps = [start]
    # Always include the peak itself when budget allows for peak localization.
    if len(stamps) < max_frames and peak not in stamps and 0 <= peak < video_duration_ms:
        stamps.append(int(peak))
        stamps = sorted(set(stamps))[:max_frames]
    return sorted(set(s for s in stamps if 0 <= s < int(video_duration_ms)))[:max_frames]


def build_frame_samples(
    timestamps_ms: List[int],
    *,
    video_ref: str,
    video_url: str,
    scene_boundaries: Optional[List[SceneBoundary]] = None,
) -> List[dict]:
    """Build FrameSample dicts for VLM gateway (presigned per-frame would be generated by worker/storage)."""
    boundary_set = {b.timestamp_ms: b for b in (scene_boundaries or [])}
    samples: List[dict] = []
    for ts in timestamps_ms:
        # find nearest boundary within 1000ms
        is_boundary = any(abs(ts - b.timestamp_ms) <= 1000 for b in (scene_boundaries or []))
        score = None
        for b in (scene_boundaries or []):
            if abs(ts - b.timestamp_ms) <= 1000:
                score = b.score
                break
        # In mock/minimal path video_url doubles as frame_ref placeholder with timestamp query
        frame_ref = f"{video_url}#t={ts}" if video_url else f"{video_ref}#t={ts}"
        samples.append(
            {
                "timestamp": ts,
                "frame_ref": frame_ref,
                "scene_change_score": score,
                "is_scene_boundary": bool(is_boundary),
            }
        )
    return samples


# ── Cost governance helpers ─────────────────────────────────────────────

def estimate_cost(
    frame_count: int,
    *,
    cost_per_image_tokens: int = 800,
    max_total_image_tokens: int = 12000,
    max_frames: int = 12,
    max_budget_usd: float | None = None,
    price_per_1k_tokens_usd: float = 0.005,
) -> dict:
    """Token/image estimation + budget check (requirement 4).

    Returns VisualCostEstimate-shaped dict.
    """
    estimated_image_tokens = frame_count * cost_per_image_tokens
    # assume ~1000 overhead text tokens
    estimated_total = estimated_image_tokens + 1000
    estimated_cost = (estimated_total / 1000.0) * price_per_1k_tokens_usd if price_per_1k_tokens_usd else None
    within = True
    reason = None
    if frame_count > max_frames:
        within = False
        reason = f"frame_count {frame_count} exceeds max_frames {max_frames}"
    elif estimated_image_tokens > max_total_image_tokens:
        within = False
        reason = f"estimated_image_tokens {estimated_image_tokens} exceeds max_total_image_tokens {max_total_image_tokens}"
    elif max_budget_usd is not None and estimated_cost is not None and estimated_cost > max_budget_usd:
        within = False
        reason = f"estimated_cost ${estimated_cost:.4f} exceeds budget ${max_budget_usd:.4f}"
    return {
        "frames": frame_count,
        "estimated_image_tokens": estimated_image_tokens,
        "estimated_total_tokens": estimated_total,
        "estimated_cost_usd": estimated_cost,
        "within_budget": within,
        "reason": reason,
    }
