from __future__ import annotations

from app.core.config import settings
from app.core.logging_config import get_internal_logger
from app.core.prompts import build_content_brief_prompt
from app.schemas.contract import ContentBriefRequest, ContentBriefResponse
from app.services.llm_gateway import chat, text_reasoning_extra
from app.services.provider_errors import ProviderErrorCode, ProviderException, ProviderValidation

_log = get_internal_logger("content_brief")


def _mock_response(req: ContentBriefRequest) -> ContentBriefResponse:
    first = next((s.text.strip() for s in req.transcript if s.text.strip()), "the supplied transcript")
    return ContentBriefResponse(
        correlation_id=req.correlation_id,
        status="COMPLETED",
        content_brief=f"The video opens with and develops the topic: {first[:240]}",
        usage=None,
    )


async def understand_brief(req: ContentBriefRequest) -> ContentBriefResponse:
    if not req.transcript:
        raise ProviderValidation(
            "Content brief requires a non-empty transcript",
            code=ProviderErrorCode.PROVIDER_VALIDATION_FAILED,
        )

    if settings.mock_mode or not settings.key_is_usable(req.provider.api_key):
        return _mock_response(req)

    transcript = [
        {"text": segment.text, "start_ms": segment.start_ms, "end_ms": segment.end_ms}
        for segment in req.transcript
    ]
    system, user = build_content_brief_prompt(transcript, req.source_lang)
    try:
        result = await chat(
            req.provider,
            system,
            user,
            max_tokens=2048,
            extra_body=text_reasoning_extra(
                req.provider,
                disabled=settings.disable_thinking_for_summarize,
            ),
        )
        if not result.text or not result.text.strip():
            raise ProviderValidation(
                "Content brief provider returned empty output",
                code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
            )
        return ContentBriefResponse(
            correlation_id=req.correlation_id,
            status="COMPLETED",
            content_brief=result.text.strip(),
            usage=result.usage,
        )
    except ProviderException:
        raise
