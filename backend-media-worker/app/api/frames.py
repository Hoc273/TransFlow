"""M17.1-A: Real frame extraction endpoint for VLM.

POST /internal/media/frames/extract
  Request: {video_path: str, timestamps_ms: list[int], max_dim?: int, timeout?: int}
  Response: {frames: [{timestamp_ms, data_url, width, height, sha256, bytes}]}

Security: validates video_path under allowed roots, caps timestamps at 30, no arbitrary FS.
No public storage upload — returns data:image/jpeg;base64 internally (no base64 logged).
Reuses app.services.frame_sampler.extract_frames_as_data_urls (ffmpeg image2pipe).
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.services.frame_sampler import extract_frames_as_data_urls, MAX_FRAMES_BATCH
from app.services.ffmpeg import FFmpegError

router = APIRouter()

_ALLOWED_ROOTS = [
    "/data",
    "/tmp",
    str(Path(tempfile.gettempdir()).resolve()),
]

def _is_allowed(p: str) -> bool:
    try:
        rp = str(Path(p).resolve())
        for root in _ALLOWED_ROOTS:
            if rp.startswith(str(Path(root).resolve())):
                return True
        # Also allow /app/* for container's working dir
        if rp.startswith("/app"):
            return True
        # Allow video_tests / outputs when running locally (no container)
        if "video_tests" in rp or "outputs" in rp:
            return True
        return False
    except Exception:
        return False

class ExtractFramesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    video_path: str = Field(description="Local video file path on worker container (absolute or /tmp/…)")
    timestamps_ms: List[int] = Field(min_length=1, max_length=30, description="Timestamps to extract (ms, sorted)")
    max_dim: Optional[int] = Field(default=1024, ge=256, le=2048, description="Longest side scaled to this (cost control)")
    timeout: Optional[int] = Field(default=15, ge=5, le=60, description="Per-frame timeout seconds")

class FrameResult(BaseModel):
    timestamp_ms: int
    data_url: str
    width: int
    height: int
    sha256: str
    bytes: int

class ExtractFramesResponse(BaseModel):
    frames: List[FrameResult]
    video_path: str
    count: int

@router.post("/frames/extract", response_model=ExtractFramesResponse)
async def extract_frames(req: ExtractFramesRequest):
    # Validate
    if not req.video_path or ".." in req.video_path:
        raise HTTPException(status_code=400, detail="video_path traversal or empty")
    # Allow http(s) URL? For now worker expects local file; if http, return 400 instruct to use presigned download at backend-ai
    if req.video_path.startswith("http://") or req.video_path.startswith("https://"):
        raise HTTPException(status_code=400, detail="Worker frame extract expects local file path, not http URL — download at caller")
    # Check existence
    p = Path(req.video_path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail=f"Video file not found: {req.video_path}")
    if not _is_allowed(req.video_path):
        raise HTTPException(status_code=403, detail="video_path not in allowed roots")
    if len(req.timestamps_ms) > MAX_FRAMES_BATCH:
        raise HTTPException(status_code=400, detail=f"Too many frames: {len(req.timestamps_ms)} > {MAX_FRAMES_BATCH}")
    # Validate timestamps ms >=0
    for ts in req.timestamps_ms:
        if ts < 0 or ts > 30 * 60 * 1000:
            raise HTTPException(status_code=400, detail=f"Invalid timestamp {ts}ms")
    try:
        frames = extract_frames_as_data_urls(
            str(p),
            req.timestamps_ms,
            max_frames=MAX_FRAMES_BATCH,
            max_dim=req.max_dim or 1024,
        )
        # Map to response — do NOT log data_url
        result = []
        for f in frames:
            result.append(FrameResult(
                timestamp_ms=f["timestamp"],
                data_url=f["frame_ref"],
                width=f["width"],
                height=f["height"],
                sha256=f["sha256"],
                bytes=f["bytes"],
            ))
        return ExtractFramesResponse(frames=result, video_path=str(p), count=len(result))
    except FFmpegError as e:
        raise HTTPException(status_code=500, detail={"code": e.code, "message": str(e), "retryable": e.retryable})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
