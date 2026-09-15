"""Visual Understanding gateway (TASK 7).

Exposes the Spring → FastAPI wire for /media/understand/visual.
Orchestrates: frame sampling → cost governance → cache → VLM → grouping → multimodal context.
"""
from __future__ import annotations

from app.core.config import settings
from app.core.logging_config import get_internal_logger, get_provider_logger
from app.schemas.contract import ProviderPayload
from app.schemas.error import ProviderErrorDetail
from app.schemas.visual_contract import VisualUnderstandRequest, VisualUnderstandResponse
from app.services.provider_errors import ProviderErrorCode, ProviderException, ProviderValidation
from app.services.visual.vlm_gateway import understand_visual

_int_log = get_internal_logger("visual_understanding")
_prov_log = get_provider_logger("visual_understanding")


def _failed(req: VisualUnderstandRequest, message: str, code: ProviderErrorCode, raw: str = "") -> VisualUnderstandResponse:
    err = ProviderValidation(message, code=code, provider=req.provider.base_url if req.provider else None,
                             protocol=req.provider.protocol if req.provider else None, capability="VISION")
    detail = err.to_error_detail()
    _int_log.warning(
        "VISUAL_UNDERSTAND failed code=%s retryable=%s reason=%s raw_preview=%r",
        detail.get("errorCode"),
        detail.get("retryable"),
        message,
        raw[:800],
        extra={"errorCode": detail.get("errorCode"), "provider": req.provider.base_url if req.provider else None,
               "protocol": req.provider.protocol if req.provider else None, "capability": "VISION", "retryable": detail.get("retryable")},
    )
    return VisualUnderstandResponse(
        correlation_id=req.correlation_id,
        status="FAILED",
        error=message,
        error_detail=detail,
    )


async def understand(req: VisualUnderstandRequest) -> VisualUnderstandResponse:
    # Validate frame_samples not entire video
    if req.frame_samples is not None and len(req.frame_samples) > req.sampling_config.max_frames:
        return _failed(req, f"frame_samples {len(req.frame_samples)} exceeds max_frames {req.sampling_config.max_frames}",
                       ProviderErrorCode.PROVIDER_VALIDATION_FAILED)

    try:
        result = await understand_visual(
            video_ref=req.video_ref,
            video_url=req.video_url,
            provider=req.provider,
            sampling_config=req.sampling_config,
            transcript=req.transcript,
            frame_samples=[f.model_dump() for f in req.frame_samples] if req.frame_samples else None,
            video_duration_ms=req.video_duration_ms,
            mock_variant=None,
        )
        # Defense-in-depth: strip internal underscore-prefixed diagnostics
        # (_width/_height/_sha256/_bytes from frame_extractor) — they are not
        # part of the FrameSample wire contract (extra="forbid") and must never
        # break VisualUnderstandResponse validation no matter which internal
        # path produced them (prod incident: 48x extra_forbidden on aa9e9d12).
        raw_samples = result["frame_samples"] or []
        wire_samples = [
            {k: v for k, v in s.items() if not k.startswith("_")} if isinstance(s, dict) else s
            for s in raw_samples
        ]
        return VisualUnderstandResponse(
            correlation_id=req.correlation_id,
            status="COMPLETED",
            observations=result["observations"],
            scenes=result["scenes"],
            cost=result["cost"],
            multimodal_context=result["multimodal_context"],
            frame_samples=wire_samples,
            cache_hit=result["cache_hit"],
            usage=result.get("usage"),
            provider_request_ids=result.get("provider_request_ids") or [],
        )
    except ProviderException as exc:
        detail = exc.to_error_detail()
        _int_log.warning("VISUAL_UNDERSTAND LLM call failed: errorCode=%s retryable=%s message=%s",
                         detail.get("errorCode"), detail.get("retryable"), exc.message)
        return VisualUnderstandResponse(
            correlation_id=req.correlation_id,
            status="FAILED",
            error=str(exc),
            error_detail=detail,
        )
    except Exception as exc:  # noqa: BLE001
        return _failed(req, f"Visual understanding failed: {exc}", ProviderErrorCode.PROVIDER_INTERNAL_ERROR)
