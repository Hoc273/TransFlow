"""Media AI endpoints (docs/16-media-api-contract.md)."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.logging_config import get_frontend_logger, get_internal_logger
from app.schemas.contract import (
    ContentBriefRequest,
    ContentBriefResponse,
    NarrativeSummarizeRequest,
    NarrativeSummarizeResponse,
    ProviderPayload,
    SttRequest,
    SttResponse,
    SummarizeRequest,
    SummarizeResponse,
    TtsRequest,
    TtsResponse,
    TtsVoicesResponse,
    ValidateProviderResponse,
)
from app.schemas.visual_contract import VisualUnderstandRequest, VisualUnderstandResponse
from app.services import content_brief_gateway
from app.services import narrative_summarize_gateway
from app.services import stt_gateway
from app.services import summarize_gateway
from app.services import tts_gateway
from app.services import visual_understanding_gateway
from app.services.provider_errors import ProviderException

_int_log = get_internal_logger("media")
_fe_log = get_frontend_logger("media")

media_router = APIRouter(prefix="/media")


@media_router.post("/stt", response_model=SttResponse)
async def stt(req: SttRequest) -> SttResponse:
    """Transcribe audio from a presigned URL using a Whisper-compatible provider."""
    try:
        return await stt_gateway.transcribe(req)
    except ProviderException as exc:
        _fe_log.warning("STT failed: errorCode=%s retryable=%s", exc.code, exc.retryable,
                         extra={"errorCode": exc.code, "provider": exc.provider,
                                "protocol": exc.protocol, "retryable": exc.retryable})
        return SttResponse(
            correlation_id=req.correlation_id,
            status="FAILED",
            error=str(exc),
            error_detail=exc.to_error_detail(),
        )


@media_router.post("/stt/validate", response_model=ValidateProviderResponse)
async def stt_validate(provider: ProviderPayload) -> ValidateProviderResponse:
    """Validate an STT provider by calling GET {base_url}/models (OpenAI-compatible).

    .. deprecated::
        Use ``POST /ai/validate/stt-probe`` (Phase 3 of 4-phase validation framework)
        instead. This endpoint only checks /models reachability, not actual transcription.
        Kept for backward compatibility — will be removed in Phase D.
    """
    return await stt_gateway.validate_provider(provider)


@media_router.post("/understand/brief", response_model=ContentBriefResponse)
async def understand_brief(req: ContentBriefRequest) -> ContentBriefResponse:
    """Source-grounded content brief for generative narrative planning (internal).

    Spring Boot is the only caller. Brief is an enhancement for NARRATIVE_REVIEW;
    failures are handled by Spring with graceful degradation.
    """
    try:
        return await content_brief_gateway.understand_brief(req)
    except ProviderException as exc:
        _fe_log.warning(
            "CONTENT_BRIEF failed: errorCode=%s retryable=%s",
            exc.code,
            exc.retryable,
            extra={
                "errorCode": exc.code,
                "provider": exc.provider,
                "protocol": exc.protocol,
                "retryable": exc.retryable,
            },
        )
        return ContentBriefResponse(
            correlation_id=req.correlation_id,
            status="FAILED",
            error=str(exc),
            error_detail=exc.to_error_detail(),
        )


@media_router.post("/summarize", response_model=SummarizeResponse)
async def summarize(req: SummarizeRequest) -> SummarizeResponse:
    """Generate 3 summary proposals from a transcript."""
    return await summarize_gateway.summarize(req)


@media_router.post("/summarize/narrative", response_model=NarrativeSummarizeResponse)
async def summarize_narrative(req: NarrativeSummarizeRequest) -> NarrativeSummarizeResponse:
    """CT5.2 internal: C_PLAN NARRATIVE_REVIEW → NarrativePlan candidates.

    Spring Boot is the only caller; product unlock / public API is out of scope.
    """
    return await narrative_summarize_gateway.summarize_narrative(req)


@media_router.post("/tts", response_model=TtsResponse)
async def tts(req: TtsRequest) -> TtsResponse:
    """Synthesize audio for translated segments."""
    return await tts_gateway.synthesize(req)


@media_router.post("/tts/voices", response_model=TtsVoicesResponse)
async def list_tts_voices(
    provider: ProviderPayload,
) -> TtsVoicesResponse:
    """List voices available for a TTS provider."""
    # ProviderException is caught by the global handler in main.py and
    # returns a structured ProviderErrorDetail body with errorCode, retryable,
    # recommendedAction, etc.
    return await tts_gateway.list_voices(provider)


@media_router.post("/understand/visual", response_model=VisualUnderstandResponse)
async def understand_visual(req: VisualUnderstandRequest) -> VisualUnderstandResponse:
    """TASK 7 multimodal visual understanding — VLM observations + temporal grouping.

    Spring Boot is the only caller; goes through CEP/ProviderPayload abstraction.
    Cost governance (max frames, token estimate, budget) is enforced before VLM calls.
    Cache key: hash(video_ref + timestamp + model + prompt_version).
    """
    try:
        return await visual_understanding_gateway.understand(req)
    except ProviderException as exc:
        _fe_log.warning("VISUAL_UNDERSTAND failed: errorCode=%s retryable=%s", exc.code, exc.retryable,
                         extra={"errorCode": exc.code, "provider": exc.provider,
                                "protocol": exc.protocol, "retryable": exc.retryable})
        return VisualUnderstandResponse(
            correlation_id=req.correlation_id,
            status="FAILED",
            error=str(exc),
            error_detail=exc.to_error_detail(),
        )
