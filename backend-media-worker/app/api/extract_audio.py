import logging
import os
import tempfile
import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.async_utils import blocking as _blocking
from app.services.callback import send_complete
from app.services.ffmpeg import FFmpegError, extract_audio, get_duration
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter()


class ExtractAudioRequest(BaseModel):
    correlation_id: str
    media_job_id: str
    source_video_ref: str


class ExtractAudioResponse(BaseModel):
    correlation_id: str
    status: str
    audio_ref: str | None = None
    duration_ms: int | None = None
    error: dict | None = None


@router.post("/extract-audio", response_model=ExtractAudioResponse)
async def extract_audio_endpoint(req: ExtractAudioRequest) -> ExtractAudioResponse:
    logger.info("Extract audio request: correlation=%s job=%s", req.correlation_id, req.media_job_id)
    temp_dir = tempfile.mkdtemp(prefix="extract_")
    try:
        audio_ref, duration_ms = await _blocking(_extract_audio_sync, req, temp_dir)

        return ExtractAudioResponse(
            correlation_id=req.correlation_id,
            status="COMPLETED",
            audio_ref=audio_ref,
            duration_ms=duration_ms,
        )
    except FFmpegError as exc:
        logger.exception("Extract audio failed: %s", exc.code)
        return ExtractAudioResponse(
            correlation_id=req.correlation_id,
            status="FAILED",
            error={"code": exc.code, "message": str(exc), "retryable": exc.retryable},
        )
    except Exception as exc:
        logger.exception("Extract audio failed")
        return ExtractAudioResponse(
            correlation_id=req.correlation_id,
            status="FAILED",
            error={"code": "FFMPEG_FAILED", "message": str(exc)},
        )
    finally:
        _cleanup(temp_dir)


def _extract_audio_sync(req: ExtractAudioRequest, temp_dir: str) -> tuple[str, int]:
    storage = get_storage()
    source_path = os.path.join(temp_dir, "source_video")
    storage.download(req.source_video_ref, source_path)

    output_path = os.path.join(temp_dir, "extracted_audio.wav")
    extract_audio(source_path, output_path)

    duration = get_duration(output_path)
    object_key = f"extracted/{req.media_job_id}/{uuid.uuid4()}.wav"
    audio_ref = storage.upload(output_path, object_key)
    return audio_ref, int(duration * 1000)


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
