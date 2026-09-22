"""Internal media probe endpoint (ADR-CEP Phase C1). Not a public API."""

from __future__ import annotations

import os
import shutil
import tempfile
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.async_utils import blocking as _blocking
from app.services.ffmpeg import FFmpegError
from app.services.media_probe import probe_video
from app.services.storage import get_storage

router = APIRouter()


class ProbeRequest(BaseModel):
    ref: str = Field(min_length=1)


@router.post("/probe")
async def probe_endpoint(req: ProbeRequest) -> dict[str, Any]:
    """Sync probe of one stored object: download once, ffprobe once.

    The worker stays stateless — it does not touch the DB, does not know
    MediaAsset ownership, and never decides compatibility or backfill.
    """
    if not req.ref.strip():
        raise HTTPException(
            status_code=422,
            detail={"code": "PROBE_PAYLOAD_INVALID", "detail": "blank object ref"},
        )
    return await _blocking(run_probe, req.ref)


def run_probe(ref: str) -> dict[str, Any]:
    storage = get_storage()
    temp_dir = tempfile.mkdtemp(prefix="probe_")
    source_path = os.path.join(temp_dir, "source_video")
    try:
        try:
            storage.download(ref, source_path)
        except Exception as exc:  # noqa: BLE001 — MinIO SDK raises S3Error/OSError variants
            raise HTTPException(
                status_code=404,
                detail={"code": "PROBE_OBJECT_UNAVAILABLE", "detail": "object download failed"},
            ) from exc
        try:
            result = probe_video(source_path)
        except FFmpegError as exc:
            message = str(exc)
            if "malformed" in message:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "PROBE_PAYLOAD_INVALID", "detail": "ffprobe returned malformed metadata"},
                ) from exc
            raise HTTPException(
                status_code=502,
                detail={"code": "PROBE_EXECUTION_FAILED", "detail": message},
            ) from exc
    finally:
        # Every path (success, ffprobe error, download error) frees the temp dir —
        # repeated re-probe/backfill must never leak downloaded media on disk.
        shutil.rmtree(temp_dir, ignore_errors=True)
    return result.to_payload()
