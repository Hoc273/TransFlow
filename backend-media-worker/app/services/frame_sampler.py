"""Frame sampling for TASK 7 — scene-aware, configurable, not entire video.

Worker-side helper: given a local video path, detect scene boundaries via ffmpeg
select filter and sample timestamps.

Used by backend-ai when video_url is not directly accessible as image list;
alternatively backend-ai samples timestamps logically. This module provides
the ffmpeg-accurate path.
"""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from typing import List, Optional

from app.services.ffmpeg import FFmpegError


@dataclass(frozen=True)
class SceneBoundary:
    timestamp_ms: int
    score: float


def detect_scene_boundaries(
    video_path: str,
    *,
    threshold: float = 0.3,
    timeout: int = 120,
) -> List[SceneBoundary]:
    """Detect scene change boundaries using ffmpeg select='gt(scene,THRESHOLD)'.

    Parses lavfi metadata via ffprobe JSON. Falls back to empty list on probe error
    (sampling degrades to uniform interval, satisfying 'if possible' requirement).
    """
    # Alternative robust method: use ffmpeg with select filter and emit frame metadata
    # Simplest: ffprobe select not precise; use ffmpeg -vf "select=gt(scene,0.3),showinfo" parsed from stderr.
    # More deterministic: use ffprobe -skip_frame nokey + scene_score?
    # Practical V1: use ffmpeg with showinfo and parse, or fall back to uniform if ffprobe unavailable.
    # We'll implement via ffmpeg showinfo parsing for accuracy, with 60s timeout guard.
    cmd = [
        "ffmpeg",
        "-i", video_path,
        "-filter:v", f"select='gt(scene,{threshold})',showinfo",
        "-f", "null",
        "-vsync", "vfr",
        "-loglevel", "info",
        "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        output = result.stderr or ""
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError(f"scene detection timed out after {timeout}s", "RENDER_TIMEOUT", retryable=False) from exc
    except FileNotFoundError as exc:
        # ffmpeg not available → degrade to uniform (not fatal)
        return []
    except Exception:
        return []

    boundaries: List[SceneBoundary] = []
    # showinfo lines contain pts_time:123.456 with scene detection
    # Example: [Parsed_showinfo_1 @ ...] n: 123 pts: 307200 pts_time:3.200 ...
    import re

    pts_pattern = re.compile(r"pts_time:([0-9.]+)")
    for line in output.splitlines():
        if "pts_time:" in line and ("showinfo" in line or "Parsed" in line):
            m = pts_pattern.search(line)
            if m:
                try:
                    pts_time = float(m.group(1))
                    ms = int(pts_time * 1000)
                    # use threshold as score proxy; real score not parsed from showinfo
                    boundaries.append(SceneBoundary(timestamp_ms=ms, score=threshold))
                except ValueError:
                    continue
    return boundaries


def get_duration_ms(video_path: str, timeout: int = 60) -> int:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        video_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=True)
        return int(float(result.stdout.strip().strip()) * 1000)
    except Exception as exc:
        raise FFmpegError(f"ffprobe duration failed: {exc}", "INVALID_INPUT", retryable=False) from exc


def sample_frames(
    video_path: str,
    *,
    interval_ms: int = 3000,
    max_frames: int = 12,
    scene_aware: bool = True,
    scene_threshold: float = 0.3,
    timeout: int = 120,
) -> List[int]:
    """Sample timestamps (ms) for VLM — capped, never entire video.

    If scene_aware, includes scene boundaries + uniform fill; else uniform.
    """
    duration_ms = get_duration_ms(video_path)
    if duration_ms <= 0:
        return []
    if interval_ms <= 0:
        interval_ms = 3000
    if max_frames <= 0:
        max_frames = 12

    # uniform baseline (mirrors backend-ai frame_sampler.sample_timestamps)
    ideal_uniform = max(1, (duration_ms + interval_ms - 1) // interval_ms)
    if ideal_uniform > max_frames:
        interval_ms = max(interval_ms, (duration_ms + max_frames - 1) // max_frames)
        ideal_uniform = max(1, (duration_ms + interval_ms - 1) // interval_ms)
        if ideal_uniform > max_frames:
            ideal_uniform = max_frames
    uniform = [i * interval_ms for i in range(ideal_uniform)]
    uniform = [t for t in uniform if t < duration_ms]
    if not uniform:
        uniform = [0]
    if duration_ms > 2000 and uniform[-1] < duration_ms - 500:
        if len(uniform) < max_frames:
            uniform.append(min(duration_ms - 500, uniform[-1] + interval_ms))
        else:
            uniform[-1] = min(duration_ms - 500, duration_ms - 1)

    if not scene_aware:
        return sorted(set(uniform))[:max_frames]

    boundaries = []
    try:
        boundaries = detect_scene_boundaries(video_path, threshold=scene_threshold, timeout=timeout)
    except Exception:
        boundaries = []

    if not boundaries:
        return sorted(set(uniform))[:max_frames]

    scene_points = [min(duration_ms - 1, b.timestamp_ms + 500) for b in boundaries if b.score >= scene_threshold]
    scene_points = sorted(set(p for p in scene_points if 0 <= p < duration_ms))

    min_distance = max(800, interval_ms // 2)
    merged: List[int] = []
    for t in sorted(set(scene_points + uniform)):
        if not merged or t - merged[-1] >= min_distance:
            merged.append(t)
    merged = sorted(set(merged))
    if len(merged) > max_frames:
        keep = sorted(set(scene_points))[:max_frames]
        remaining = max_frames - len(keep)
        if remaining > 0:
            candidates = [u for u in uniform if u not in keep]

            def distance_to_keep(u: int) -> int:
                return min(abs(u - k) for k in keep) if keep else u

            candidates.sort(key=distance_to_keep, reverse=True)
            keep.extend(candidates[:remaining])
        merged = sorted(set(keep))
        if len(merged) < max_frames:
            extra = [u for u in uniform if u not in merged]
            merged.extend(extra[: max_frames - len(merged)])
            merged = sorted(merged)
    merged = [t for t in merged if 0 <= t < duration_ms]
    return sorted(set(merged))[:max_frames]


def extract_frame(
    video_path: str,
    timestamp_ms: int,
    output_path: str,
    *,
    timeout: int = 60,
) -> str:
    """Extract single frame as JPEG for VLM input."""
    ts = timestamp_ms / 1000.0
    cmd = [
        "ffmpeg",
        "-y",
        "-ss", str(ts),
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        "-vf", "scale=1280:-2",
        output_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError(f"extract_frame timed out", "RENDER_TIMEOUT", retryable=False) from exc
    except subprocess.CalledProcessError as exc:
        raise FFmpegError(f"extract_frame failed: {exc.stderr}", "RENDER_FAILED", retryable=True) from exc
    return output_path


# ── M17.1-A: batch extraction to data URLs (real frame → real VLM) ──────────

MAX_FRAME_BYTES = 2 * 1024 * 1024
PER_FRAME_TIMEOUT = 15
MAX_FRAMES_BATCH = 30

def _validate_jpeg_header(data: bytes) -> None:
    if len(data) < 8 or data[:2] != b"\xff\xd8":
        raise FFmpegError("Invalid JPEG header for extracted frame", "INVALID_INPUT", retryable=False)
    if len(data) > MAX_FRAME_BYTES:
        raise FFmpegError(f"Frame exceeds {MAX_FRAME_BYTES} bytes", "INVALID_INPUT", retryable=False)

def extract_frame_to_base64(
    video_path: str,
    timestamp_ms: int,
    *,
    timeout: int = PER_FRAME_TIMEOUT,
    max_dim: int = 1024,
) -> tuple[str, int, int, str]:
    """Extract one frame as data URL.

    Returns (data_url, width, height, sha256_hex).
    Scaled longest side to max_dim for cost control.
    """
    import base64
    import hashlib
    import io
    ts = timestamp_ms / 1000.0
    vf = f"scale='if(gt(iw,ih),{max_dim},-2)':'if(gt(iw,ih),-2,{max_dim})':flags=lanczos"
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-ss", f"{ts:.3f}",
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        "-vf", vf,
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "pipe:1",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError(f"extract_frame_to_base64 timed out at {timestamp_ms}ms", "RENDER_TIMEOUT", retryable=False) from exc
    except FileNotFoundError as exc:
        raise FFmpegError("ffmpeg not available", "RENDER_FAILED", retryable=False) from exc
    if result.returncode != 0:
        stderr = (result.stderr or b"")[:500].decode(errors="ignore")
        raise FFmpegError(f"ffmpeg frame extraction failed at {timestamp_ms}ms: {stderr}", "RENDER_FAILED", retryable=True)
    data = result.stdout
    if not data or len(data) < 100:
        raise FFmpegError(f"Empty frame at {timestamp_ms}ms", "RENDER_FAILED", retryable=True)
    _validate_jpeg_header(data)
    # dimensions via PIL if available
    width = height = max_dim
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        width, height = im.size
    except Exception:
        pass
    sha = hashlib.sha256(data).hexdigest()
    b64 = base64.b64encode(data).decode("ascii")
    data_url = f"data:image/jpeg;base64,{b64}"
    return data_url, width, height, sha

def extract_frames_as_data_urls(
    video_path: str,
    timestamps_ms: list[int],
    *,
    max_frames: int = MAX_FRAMES_BATCH,
    timeout: int = PER_FRAME_TIMEOUT,
    max_dim: int = 1024,
) -> list[dict]:
    """Batch extract — fail-closed per M17.1-A.

    Returns list of {timestamp, frame_ref:data_url, width, height, sha256, bytes}.
    Never decodes entire video into memory; each frame is a separate ffmpeg pipe.
    """
    if len(timestamps_ms) > max_frames:
        raise FFmpegError(f"Requested {len(timestamps_ms)} frames > max {max_frames}", "INVALID_INPUT", retryable=False)
    if not timestamps_ms:
        return []
    out: list[dict] = []
    for ts in sorted(set(int(t) for t in timestamps_ms)):
        data_url, w, h, sha = extract_frame_to_base64(video_path, ts, timeout=timeout, max_dim=max_dim)
        # approximate bytes from base64 length
        b64_len = len(data_url.split(",", 1)[1]) if "," in data_url else 0
        approx_bytes = (b64_len * 3) // 4
        out.append({
            "timestamp": int(ts),
            "frame_ref": data_url,
            "width": w,
            "height": h,
            "sha256": sha,
            "bytes": approx_bytes,
        })
    return out
