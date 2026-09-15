"""AI microservice endpoints.

Spring Boot is the only caller. Each endpoint:
  1. builds an XML-tagged prompt (Rule 2),
  2. calls the LLM Gateway (BYOK provider or mock),
  3. coerces the reply into the contract's JSON shape,
  4. returns result + token usage.

Business/validation failures return HTTP 200 with status=FAILED + error;
provider/config failures surface as structured ProviderException errors
caught by the global handler in main.py.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.api.structured import parse_json_object
from app.core.config import settings
from app.core.logging_config import get_frontend_logger, get_internal_logger
from app.core.prompts import build_qa_prompt, build_translate_prompt
from app.schemas.contract import (
    QAIssue,
    QARequest,
    QAResponse,
    TranslateRequest,
    TranslateResponse,
    ValidateProviderRequest,
    ValidateProviderResponse,
)
from app.services import llm_gateway
from app.services.provider_errors import ProviderErrorCode, ProviderException

_int_log = get_internal_logger("routes")
_fe_log = get_frontend_logger("routes")

router = APIRouter()


def _text_extra_body() -> dict | None:
    """Build the thinking-disabled extra_body for TEXT calls (translate/qa).

    Mirrors the summarize gateway: when the setting is on, pass the
    documented DeepSeek V4 kill-switch so reasoning-capable models emit
    JSON directly into ``content`` instead of ``reasoning_content``.
    Non-DeepSeek providers ignore the unknown field per OpenAI spec.
    """
    if settings.disable_thinking_for_translate:
        return {"thinking": {"type": "disabled"}}
    return None


def _classify_text_failure(raw_text: str, finish_reason: str) -> tuple[str, str]:
    """Map an empty/non-JSON translate output to a precise error message."""
    if finish_reason == "length":
        return (
            "Model output was truncated (finish_reason=length); increase "
            "translate_max_tokens or shorten the input segment.",
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED.value,
        )
    if raw_text is None or not raw_text.strip():
        return (
            "Model returned empty output",
            ProviderErrorCode.PROVIDER_EMPTY_RESPONSE.value,
        )
    return (
        "Model returned non-JSON output",
        ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED.value,
    )


@router.post("/ai/translate", response_model=None)
async def translate(req: TranslateRequest) -> TranslateResponse | StreamingResponse:
    system, user = build_translate_prompt(
        req.source_lang,
        req.target_lang,
        req.source_text,
        req.glossary,
        req.context,
    )
    if req.options and req.options.get("stream") is True:
        return StreamingResponse(
            _translate_stream(req, system, user),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        result = await llm_gateway.chat(
            req.provider,
            system,
            user,
            max_tokens=settings.translate_max_tokens,
            response_format={"type": "json_object"},
            extra_body=_text_extra_body(),
        )
    except ProviderException as exc:
        return _translate_failed(req, exc)

    try:
        obj = parse_json_object(result.text)
    except ValueError:
        message, _code = _classify_text_failure(result.text, result.finish_reason)
        _int_log.warning(
            "translate parse failure request_id=%s finish_reason=%s text_len=%d code=%s",
            req.request_id,
            result.finish_reason,
            len(result.text or ""),
            _code,
        )
        return _translate_failed(req, message)

    translation = obj.get("translation")
    _int_log.info(
        "translate parsed response request_id=%s raw_response_chars=%d response_keys=%s translation_chars=%d",
        req.request_id,
        len(result.text or ""),
        sorted(str(key) for key in obj),
        len(translation) if isinstance(translation, str) else 0,
    )
    if not isinstance(translation, str) or not translation.strip():
        _int_log.warning("translate validation failure request_id=%s: blank translation", req.request_id)
        return _translate_failed(req, "Model returned an empty translation")

    return TranslateResponse(
        request_id=req.request_id,
        status="COMPLETED",
        translation=translation,
        applied_glossary=obj.get("applied_glossary", []) or [],
        usage=result.usage,
    )


@router.post("/ai/qa", response_model=QAResponse)
async def qa(req: QARequest) -> QAResponse:
    system, user = build_qa_prompt(
        req.source_lang,
        req.target_lang,
        req.source_text,
        req.translated_text,
        req.glossary,
        req.checks,
    )
    try:
        result = await llm_gateway.chat(
            req.provider,
            system,
            user,
            max_tokens=settings.translate_max_tokens,
            response_format={"type": "json_object"},
            extra_body=_text_extra_body(),
        )
    except ProviderException as exc:
        return QAResponse(request_id=req.request_id, status="FAILED", error=str(exc))

    try:
        obj = parse_json_object(result.text)
    except ValueError:
        message, _code = _classify_text_failure(result.text, result.finish_reason)
        return QAResponse(
            request_id=req.request_id,
            status="FAILED",
            error=message,
        )

    raw_issues = obj.get("issues", [])
    if not isinstance(raw_issues, list):
        return QAResponse(
            request_id=req.request_id,
            status="FAILED",
            error="Model returned 'issues' in an unexpected shape",
        )
    try:
        issues = [QAIssue.model_validate(i) for i in raw_issues if isinstance(i, dict)]
    except ValidationError as exc:
        _int_log.warning("QA issues failed schema validation: %s", exc.error_count())
        return QAResponse(
            request_id=req.request_id,
            status="FAILED",
            error="Model returned issues that violate the QA schema",
        )
    return QAResponse(
        request_id=req.request_id,
        status="COMPLETED",
        issues=issues,
        score=obj.get("score") if isinstance(obj.get("score"), (int, float)) else None,
        usage=result.usage,
    )


@router.post("/ai/validate-provider", response_model=ValidateProviderResponse)
async def validate_provider(req: ValidateProviderRequest) -> ValidateProviderResponse:
    """Cheap liveness probe for a BYOK provider config (used by Provider Config UI)."""
    try:
        result = await llm_gateway.chat(
            req.provider,
            system="You are a connectivity probe.",
            user="Reply with the single word: OK",
            max_tokens=8,
        )
    except ProviderException as exc:
        return ValidateProviderResponse(ok=False, model=req.provider.model, message=str(exc))
    return ValidateProviderResponse(
        ok=True,
        model=req.provider.model,
        message="Provider reachable" + (f": {result.text[:40]}" if result.text else ""),
    )


def _translate_failed(req: TranslateRequest, error: object) -> TranslateResponse:
    return TranslateResponse(
        request_id=req.request_id,
        status="FAILED",
        error=str(error),
    )


async def _translate_stream(req: TranslateRequest, system: str, user: str):
    """SSE wrapper for the translate contract."""
    try:
        result = await llm_gateway.chat(
            req.provider,
            system,
            user,
            max_tokens=settings.translate_max_tokens,
            response_format={"type": "json_object"},
            extra_body=_text_extra_body(),
        )
    except ProviderException as exc:
        yield _sse("done", _translate_failed(req, exc).model_dump())
        return

    try:
        obj = parse_json_object(result.text)
    except ValueError:
        message, _code = _classify_text_failure(result.text, result.finish_reason)
        _int_log.warning(
            "translate-stream parse failure request_id=%s finish_reason=%s text_len=%d code=%s",
            req.request_id,
            result.finish_reason,
            len(result.text or ""),
            _code,
        )
        yield _sse("done", _translate_failed(req, message).model_dump())
        return

    translation = obj.get("translation")
    _int_log.info(
        "translate-stream parsed response request_id=%s raw_response_chars=%d response_keys=%s translation_chars=%d",
        req.request_id,
        len(result.text or ""),
        sorted(str(key) for key in obj),
        len(translation) if isinstance(translation, str) else 0,
    )
    if not isinstance(translation, str) or not translation.strip():
        _int_log.warning("translate-stream validation failure request_id=%s: blank translation", req.request_id)
        yield _sse("done", _translate_failed(req, "Model returned an empty translation").model_dump())
        return
    for chunk in _chunks(translation):
        yield _sse("token", {"delta": chunk})

    response = TranslateResponse(
        request_id=req.request_id,
        status="COMPLETED",
        translation=translation,
        applied_glossary=obj.get("applied_glossary", []) or [],
        usage=result.usage,
    )
    yield _sse("done", response.model_dump())


def _chunks(text: str, size: int = 24):
    for i in range(0, len(text), size):
        yield text[i : i + size]


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
