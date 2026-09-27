import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings
from app.services.hmac import sign_request

logger = logging.getLogger(__name__)

_MAX_CALLBACK_ATTEMPTS = 5
_BACKOFF_SECONDS = (1.0, 2.0, 4.0, 8.0, 16.0)


async def send_callback(path: str, payload: dict[str, Any]) -> bool:
    """Send a HMAC-signed callback with bounded retries."""
    url = f"{settings.callback_base_url.rstrip('/')}/{path.lstrip('/')}"
    raw_body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    for attempt in range(_MAX_CALLBACK_ATTEMPTS):
        timestamp, signature = sign_request(raw_body)
        headers = {
            "X-Timestamp": timestamp,
            "X-Signature": signature,
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, content=raw_body, headers=headers, timeout=30.0)
                response.raise_for_status()
                logger.info("Callback %s accepted (status=%s, attempt=%s)", path, response.status_code, attempt + 1)
                return True
        except httpx.HTTPError as exc:
            logger.error(
                "Callback %s failed (attempt %s/%s): %s",
                path,
                attempt + 1,
                _MAX_CALLBACK_ATTEMPTS,
                exc,
            )
            if attempt < _MAX_CALLBACK_ATTEMPTS - 1:
                await asyncio.sleep(_BACKOFF_SECONDS[min(attempt, len(_BACKOFF_SECONDS) - 1)])

    logger.error("Callback %s permanently failed after %s attempts", path, _MAX_CALLBACK_ATTEMPTS)
    return False


async def send_progress(
    media_job_id: str,
    correlation_id: str,
    progress_percent: int,
    stage_id: str | None = None,
    stage_path: str = "render",
) -> bool:
    return await send_callback(
        f"/internal/media/{stage_path}/progress",
        {
            "jobId": media_job_id,
            "stageId": stage_id,
            "dedupeKey": f"{stage_path}:{correlation_id}:progress:{progress_percent}",
            "progressPercent": progress_percent,
        },
    )


async def send_complete(
    media_job_id: str,
    correlation_id: str,
    status: str,
    output_ref: str | None = None,
    error: dict | None = None,
    warnings: list[dict] | None = None,
    srt_ref: str | None = None,
    vtt_ref: str | None = None,
    validation: dict | None = None,
    media_probe: dict | None = None,
    stage_id: str | None = None,
    stage_path: str = "render",
) -> bool:
    output: dict[str, Any] = {
        "objectRef": output_ref,
        "srtRef": srt_ref,
        "vttRef": vtt_ref,
        "completedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "warnings": warnings or [],
    }
    if validation is not None:
        output["validation"] = validation
    if media_probe is not None:
        output["mediaProbe"] = media_probe
    payload: dict[str, Any] = {
        "jobId": media_job_id,
        "stageId": stage_id,
        "dedupeKey": f"{stage_path}:{correlation_id}:complete",
        "outputRef": output,
        "success": status.upper() == "COMPLETED",
        "errorMessage": error.get("message") if error else None,
    }
    # Keep the origin worker's additive diagnostics for existing observability
    # consumers; backend-main ignores unknown top-level callback fields.
    if validation is not None:
        payload["validation"] = validation
    if media_probe is not None:
        payload["media_probe"] = media_probe
    if error is not None and error.get("code"):
        payload["errorCode"] = error["code"]
    return await send_callback(f"/internal/media/{stage_path}/complete", payload)


async def send_audio_mix_progress(
    media_job_id: str,
    correlation_id: str,
    progress_percent: int,
    stage_id: str | None = None,
) -> bool:
    return await send_callback(
        "/internal/media/audio-mix/progress",
        {
            "jobId": media_job_id,
            "stageId": stage_id,
            "dedupeKey": f"audio-mix:{correlation_id}:progress:{progress_percent}",
            "progressPercent": progress_percent,
        },
    )


async def send_audio_mix_complete(
    media_job_id: str,
    correlation_id: str,
    status: str,
    output_ref: str | None = None,
    duration_ms: int | None = None,
    error: dict | None = None,
    warnings: list[dict] | None = None,
    stage_id: str | None = None,
) -> bool:
    payload = {
        "jobId": media_job_id,
        "stageId": stage_id,
        "dedupeKey": f"audio-mix:{correlation_id}:complete",
        "outputRef": {
            "objectRef": output_ref,
            "durationMs": duration_ms,
            "completedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "warnings": warnings or [],
        },
        "success": status.upper() == "COMPLETED",
        "errorMessage": error.get("message") if error else None,
    }
    if error is not None and error.get("code"):
        payload["errorCode"] = error["code"]
    return await send_callback(
        "/internal/media/audio-mix/complete",
        payload,
    )
