"""Script-first summarization gateway (SRS v1.2+, System_Architecture §7.2)."""
from __future__ import annotations

import logging

from app.api.structured import parse_json_object
from app.core.config import settings
from app.core.prompts import build_script_summarize_prompt
from app.schemas.script import (
    ScriptRefineRequest,
    ScriptSegment,
    ScriptSummarizeRequest,
    ScriptSummarizeResponse,
)
from app.services.llm_gateway import chat, text_reasoning_extra
from app.services.provider_errors import ProviderErrorCode, ProviderException

_log = logging.getLogger("transflow.ai.script")


def _transcript_payload(req: ScriptSummarizeRequest | ScriptRefineRequest) -> list[dict]:
    return [
        {"text": segment.text, "start_ms": segment.start_ms, "end_ms": segment.end_ms}
        for segment in req.transcript
    ]


def _mock_response(
    correlation_id: str,
    target_lang: str,
    requested_duration_seconds: int,
    transcript: list[dict],
    previous_script: str | None = None,
) -> ScriptSummarizeResponse:
    script = (previous_script or " ".join(str(item.get("text", "")).strip() for item in transcript)).strip()
    if not script:
        script = "Summary script generated from the selected source footage."
    requested_ms = max(1, requested_duration_seconds) * 1000
    refs = [str(index) for index in range(len(transcript))] or ["0"]
    return ScriptSummarizeResponse(
        correlation_id=correlation_id,
        status="COMPLETED",
        script_content=script,
        script_language=target_lang,
        segments=[
            ScriptSegment(
                start_ms=0,
                end_ms=requested_ms,
                script_excerpt=script,
                source_sentence_refs=refs,
                reasoning_note="Mock script segment grounded in the supplied transcript.",
            )
        ],
        reasoning_note="Deterministic mock script proposal.",
        confidence=0.75,
        warnings=["MOCK_MODE"],
    )


def _failed(req: ScriptSummarizeRequest | ScriptRefineRequest, message: str, code: str | None = None) -> ScriptSummarizeResponse:
    return ScriptSummarizeResponse(
        correlation_id=req.correlation_id,
        status="FAILED",
        error=message,
        error_detail={"errorCode": code} if code else None,
    )


def _requested_duration(req: ScriptSummarizeRequest | ScriptRefineRequest) -> int:
    if req.requested_duration_seconds:
        return req.requested_duration_seconds
    transcript_end = max((segment.end_ms for segment in req.transcript), default=60_000)
    return max(1, round(transcript_end / 2000))


def _parse_response(req: ScriptSummarizeRequest | ScriptRefineRequest, raw: str, usage) -> ScriptSummarizeResponse:
    try:
        payload = parse_json_object(raw)
        segments = [ScriptSegment.model_validate(item) for item in (payload.get("segments") or [])]
        response = ScriptSummarizeResponse(
            correlation_id=req.correlation_id,
            status="COMPLETED",
            script_content=payload.get("script_content"),
            script_language=payload.get("script_language") or req.target_lang,
            segments=segments,
            reasoning_note=payload.get("reasoning_note"),
            confidence=payload.get("confidence"),
            warnings=payload.get("warnings") or [],
            usage=usage,
        )
    except (ValueError, TypeError, KeyError) as exc:
        return _failed(
            req,
            f"Model output did not match the script contract: {exc}",
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED.value,
        )

    if not response.script_content or not response.script_content.strip() or not response.segments:
        return _failed(
            req,
            "Model returned an empty script or no matched video segments",
            ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION.value,
        )
    total_ms = 0
    for segment in response.segments:
        if segment.end_ms <= segment.start_ms:
            return _failed(req, "Script segment end_ms must be greater than start_ms")
        if segment.script_excerpt.strip() not in response.script_content:
            return _failed(req, "script_excerpt must be a substring of script_content")
        total_ms += segment.end_ms - segment.start_ms
    requested_ms = _requested_duration(req) * 1000
    if total_ms < requested_ms * 0.8 or total_ms > requested_ms * 1.2:
        return _failed(req, "Matched segment duration is outside the requested tolerance window")
    return response


async def _run(req: ScriptSummarizeRequest | ScriptRefineRequest, *, previous_script: str | None = None, feedback_text: str | None = None) -> ScriptSummarizeResponse:
    requested_duration = _requested_duration(req)
    transcript = _transcript_payload(req)
    if settings.mock_mode or not settings.key_is_usable(req.provider.api_key):
        return _mock_response(
            req.correlation_id,
            req.target_lang,
            requested_duration,
            transcript,
            previous_script=previous_script,
        )

    system, user = build_script_summarize_prompt(
        transcript,
        requested_duration,
        req.target_lang,
        req.visual_context,
        previous_script=previous_script,
        feedback_text=feedback_text,
    )
    try:
        result = await chat(
            req.provider,
            system,
            user,
            max_tokens=settings.summarize_max_tokens,
            response_format={"type": "json_object"},
            extra_body=text_reasoning_extra(req.provider, disabled=settings.disable_thinking_for_summarize),
        )
    except ProviderException as exc:
        return _failed(req, str(exc), exc.code.value if hasattr(exc.code, "value") else str(exc.code))
    return _parse_response(req, result.text or "", result.usage)


async def summarize_script(req: ScriptSummarizeRequest) -> ScriptSummarizeResponse:
    return await _run(req)


async def refine_script(req: ScriptRefineRequest) -> ScriptSummarizeResponse:
    return await _run(req, previous_script=req.previous_script, feedback_text=req.feedback_text)
