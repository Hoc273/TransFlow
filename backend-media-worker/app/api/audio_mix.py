"""AUDIO_MIX worker endpoint — executes MixPlan V1 only (CT8)."""

from __future__ import annotations

import logging
import os
import tempfile
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from app.services import cancel_registry
from app.services.callback import send_audio_mix_complete, send_audio_mix_progress
from app.services.ffmpeg import FFmpegError
from app.services.mix_executor import execute_mix_plan
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter()


class AudioMixRequest(BaseModel):
    correlation_id: str
    media_job_id: str
    mix_plan: dict[str, Any]


class AudioMixResponse(BaseModel):
    correlation_id: str
    status: str


class CancelResponse(BaseModel):
    correlation_id: str
    status: str


class MixCancelled(Exception):
    def __init__(self, correlation_id: str) -> None:
        super().__init__(f"Audio mix cancelled: {correlation_id}")
        self.correlation_id = correlation_id


@router.post("/audio-mix", response_model=AudioMixResponse)
async def audio_mix_endpoint(req: AudioMixRequest, background_tasks: BackgroundTasks) -> AudioMixResponse:
    logger.info(
        "Audio mix request: correlation=%s job=%s plan_id=%s",
        req.correlation_id,
        req.media_job_id,
        (req.mix_plan or {}).get("plan_id"),
    )
    cancel_registry.register(req.correlation_id)
    background_tasks.add_task(process_audio_mix, req)
    return AudioMixResponse(correlation_id=req.correlation_id, status="ACCEPTED")


@router.post("/audio-mix/{correlation_id}/cancel", response_model=CancelResponse)
async def cancel_audio_mix(correlation_id: str) -> CancelResponse:
    was_active = cancel_registry.request_cancel(correlation_id)
    status = "CANCEL_REQUESTED" if was_active else "NOT_FOUND_OR_IDLE"
    logger.info("Cancel audio-mix correlation=%s status=%s", correlation_id, status)
    return CancelResponse(correlation_id=correlation_id, status=status)


def _check_cancelled(correlation_id: str) -> None:
    if cancel_registry.is_cancelled(correlation_id):
        raise MixCancelled(correlation_id)


async def process_audio_mix(req: AudioMixRequest) -> None:
    temp_dir = tempfile.mkdtemp(prefix="audio_mix_")
    output_ref = None
    warnings: list[dict] = []
    try:
        _check_cancelled(req.correlation_id)
        await send_audio_mix_progress(req.media_job_id, req.correlation_id, 10)

        _check_cancelled(req.correlation_id)
        output_path, duration_ms, warnings = execute_mix_plan(req.mix_plan, temp_dir)
        await send_audio_mix_progress(req.media_job_id, req.correlation_id, 70)
        _check_cancelled(req.correlation_id)

        storage = get_storage()
        # Immutable object key per attempt — never overwrite a previous mix.
        object_key = f"mixed/{req.media_job_id}/{uuid.uuid4()}.wav"
        output_ref = storage.upload(output_path, object_key)
        await send_audio_mix_progress(req.media_job_id, req.correlation_id, 95)

        if cancel_registry.is_cancelled(req.correlation_id):
            raise MixCancelled(req.correlation_id)

        await send_audio_mix_complete(
            media_job_id=req.media_job_id,
            correlation_id=req.correlation_id,
            status="COMPLETED",
            output_ref=output_ref,
            duration_ms=duration_ms,
            warnings=warnings,
        )
        logger.info(
            "Audio mix completed correlation=%s job=%s output=%s",
            req.correlation_id,
            req.media_job_id,
            output_ref,
        )
    except MixCancelled:
        logger.info("Audio mix cancelled correlation=%s", req.correlation_id)
        await send_audio_mix_complete(
            media_job_id=req.media_job_id,
            correlation_id=req.correlation_id,
            status="FAILED",
            error={"code": "CANCELLED", "message": "Audio mix cancelled"},
        )
    except FFmpegError as exc:
        logger.exception("Audio mix failed: %s", exc.code)
        await send_audio_mix_complete(
            media_job_id=req.media_job_id,
            correlation_id=req.correlation_id,
            status="FAILED",
            error={"code": exc.code, "message": str(exc)},
        )
    except Exception as exc:
        logger.exception("Audio mix failed")
        await send_audio_mix_complete(
            media_job_id=req.media_job_id,
            correlation_id=req.correlation_id,
            status="FAILED",
            error={"code": "FFMPEG_FAILED", "message": str(exc)},
        )
    finally:
        cancel_registry.unregister(req.correlation_id)
        _cleanup(temp_dir)


def _cleanup(temp_dir: str) -> None:
    try:
        for root, dirs, files in os.walk(temp_dir, topdown=False):
            for name in files:
                os.remove(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
        os.rmdir(temp_dir)
    except Exception:
        pass
