"""Summarization gateway for media pipeline (docs/14, docs/16)."""
from __future__ import annotations

import logging

from app.api.structured import parse_json_object
from app.core.config import settings
from app.core.logging_config import get_internal_logger, get_provider_logger
from app.core.prompts import build_summarize_prompt
from app.schemas.contract import (
    SummarizeRequest,
    SummarizeResponse,
    SummaryCutRange,
    SummaryProposal,
)
from app.services.llm_gateway import chat, text_reasoning_extra
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderException,
    ProviderValidation,
)

_int_log = get_internal_logger("summarize")
_prov_log = get_provider_logger("summarize")

# Truncation constants for diagnostic logs. Keep small enough to stay in a
# single log line but large enough to recognise the failure shape.
_PROMPT_PREVIEW_CHARS = 1200
_RAW_TEXT_PREVIEW_CHARS = 800
_MODEL_NAME_PREVIEW_CHARS = 200


def _effective_requested_duration_seconds(req: SummarizeRequest) -> int:
    """Resolve the optional HYBRID duration without changing the cut-plan API."""
    if req.requested_duration_seconds:
        return req.requested_duration_seconds
    transcript_end_ms = max((segment.end_ms for segment in req.transcript), default=60_000)
    # HYBRID is an extractive assist, so target roughly half of the source
    # transcript while always retaining a valid positive duration.
    return max(1, round(transcript_end_ms / 2000))

# errorCode returned to Spring Boot when the model output cannot be coerced
# into a valid JSON object. Deterministic — the orchestrator should NOT retry.
# We force retryable=False at the gateway layer for these codes so the
# orchestrator's stage-retry policy (derived from error_detail) short-circuits.
_NON_RETRYABLE_OUTPUT_CODES = {
    ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
    ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
    ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION,
}


def _force_non_retryable(detail: dict) -> dict:
    """Override retryable=False for deterministic output-shape failures.

    The Python error-code catalog mirrors the Java one which marks
    ``PROVIDER_RESPONSE_MALFORMED`` / ``PROVIDER_EMPTY_RESPONSE`` as retryable
    because they map to HTTP 502 (transient-looking). However, when the
    SUMMARIZE gateway returns them, the cause is deterministic — the same
    model + same input will produce the same broken output. The orchestrator
    MUST NOT spin through 3 RabbitMQ retries.
    """
    if detail.get("errorCode") in {c.value for c in _NON_RETRYABLE_OUTPUT_CODES}:
        return {**detail, "retryable": False}
    return detail


def _mock_response(req: SummarizeRequest) -> SummarizeResponse:
    """Deterministic mock returning 3 valid proposals."""
    requested_ms = _effective_requested_duration_seconds(req) * 1000
    return SummarizeResponse(
        correlation_id=req.correlation_id,
        status="COMPLETED",
        proposals=[
            SummaryProposal(
                proposal_index=1,
                cut_ranges=[SummaryCutRange(start_ms=0, end_ms=requested_ms)],
                reasoning_note="Mock proposal 1: keep the whole requested span.",
                total_duration_ms=requested_ms,
                confidence=0.82,
            ),
            SummaryProposal(
                proposal_index=2,
                cut_ranges=[SummaryCutRange(start_ms=0, end_ms=requested_ms)],
                reasoning_note="Mock proposal 2: alternative mock selection.",
                total_duration_ms=requested_ms,
                confidence=0.71,
            ),
            SummaryProposal(
                proposal_index=3,
                cut_ranges=[SummaryCutRange(start_ms=0, end_ms=requested_ms)],
                reasoning_note="Mock proposal 3: another mock selection.",
                total_duration_ms=requested_ms,
                confidence=0.65,
            ),
        ],
        usage=None,
    )


def _safe_preview(text: str | None, limit: int) -> str:
    """Truncate text for logging without ever echoing api keys."""
    if text is None:
        return ""
    cleaned = text.replace("sk-", "***").replace("nvapi-", "***")
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit] + f"...<truncated {len(cleaned) - limit} chars>"


def _summarize_failed_output(
    req: SummarizeRequest,
    message: str,
    code: ProviderErrorCode,
    raw_text_preview: str,
) -> SummarizeResponse:
    """Build a deterministic-FAILED response carrying structured error code."""
    err = ProviderValidation(message, code=code)
    detail = _force_non_retryable(err.to_error_detail())
    _int_log.warning(
        "SUMMARIZE failed output code=%s retryable=%s reason=%s raw_preview=%r",
        detail.get("errorCode"),
        detail.get("retryable"),
        message,
        raw_text_preview,
        extra={
            "errorCode": detail.get("errorCode"),
            "provider": req.provider.base_url if req.provider else None,
            "protocol": req.provider.protocol if req.provider else None,
            "capability": "SUMMARIZE",
            "retryable": detail.get("retryable"),
        },
    )
    return SummarizeResponse(
        correlation_id=req.correlation_id,
        status="FAILED",
        error=message,
        error_detail=detail,
    )


def _classify_parse_failure(raw_text: str) -> tuple[str, ProviderErrorCode]:
    """Map a parse failure to a structured error code + human message."""
    if raw_text is None or not raw_text.strip():
        return ("Model returned empty output", ProviderErrorCode.PROVIDER_EMPTY_RESPONSE)
    return (
        "Model output did not contain a valid JSON object",
        ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
    )


async def summarize(req: SummarizeRequest) -> SummarizeResponse:
    """Generate 3 summary proposals from a transcript using an LLM."""
    if settings.mock_mode or not settings.key_is_usable(req.provider.api_key):
        _int_log.info(
            "SUMMARIZE mock-mode correlation_id=%s media_job_id=%s transcript_segments=%d",
            req.correlation_id,
            req.media_job_id,
            len(req.transcript),
        )
        return _mock_response(req)

    requested_duration_seconds = _effective_requested_duration_seconds(req)
    transcript = [
        {"text": seg.text, "start_ms": seg.start_ms, "end_ms": seg.end_ms}
        for seg in req.transcript
    ]
    system, user = build_summarize_prompt(
        transcript, requested_duration_seconds, req.duration_tolerance
    )

    _int_log.info(
        "SUMMARIZE request correlation_id=%s media_job_id=%s provider=%s protocol=%s "
        "model=%s requested_sec=%s transcript_segments=%d prompt_preview=%r",
        req.correlation_id,
        req.media_job_id,
        req.provider.base_url,
        req.provider.protocol,
        _safe_preview(req.provider.model, _MODEL_NAME_PREVIEW_CHARS),
        requested_duration_seconds,
        len(transcript),
        _safe_preview(user, _PROMPT_PREVIEW_CHARS),
    )

    try:
        extra_body = text_reasoning_extra(
            req.provider,
            disabled=settings.disable_thinking_for_summarize,
        )
        result = await chat(
            req.provider,
            system,
            user,
            max_tokens=settings.summarize_max_tokens,
            response_format={"type": "json_object"},
            extra_body=extra_body,
        )
    except ProviderException as exc:
        detail = _force_non_retryable(exc.to_error_detail())
        _int_log.warning(
            "SUMMARIZE LLM call failed: errorCode=%s retryable=%s message=%s",
            detail.get("errorCode"),
            detail.get("retryable"),
            exc.message,
            extra={
                "errorCode": detail.get("errorCode"),
                "provider": req.provider.base_url,
                "protocol": req.provider.protocol,
                "capability": "SUMMARIZE",
                "retryable": detail.get("retryable"),
            },
        )
        return SummarizeResponse(
            correlation_id=req.correlation_id,
            status="FAILED",
            error=str(exc),
            error_detail=detail,
        )

    raw_text = result.text or ""
    _prov_log.info(
        "SUMMARIZE provider response correlation_id=%s protocol=%s model=%s text_len=%d preview=%r",
        req.correlation_id,
        req.provider.protocol,
        req.provider.model,
        len(raw_text),
        _safe_preview(raw_text, _RAW_TEXT_PREVIEW_CHARS),
        extra={
            "provider": req.provider.base_url,
            "protocol": req.provider.protocol,
            "capability": "SUMMARIZE",
        },
    )

    if not raw_text.strip():
        return _summarize_failed_output(
            req,
            *_classify_parse_failure(raw_text),
            raw_text_preview=_safe_preview(raw_text, _RAW_TEXT_PREVIEW_CHARS),
        )

    try:
        data = parse_json_object(raw_text)
    except ValueError as exc:
        message, code = _classify_parse_failure(raw_text)
        _int_log.warning(
            "SUMMARIZE json-parse failure: %s parser_msg=%s",
            message,
            exc,
        )
        return _summarize_failed_output(
            req,
            message,
            code,
            raw_text_preview=_safe_preview(raw_text, _RAW_TEXT_PREVIEW_CHARS),
        )

    raw_proposals = data.get("proposals")
    if not isinstance(raw_proposals, list):
        return _summarize_failed_output(
            req,
            "Model output did not contain a 'proposals' array",
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
            raw_text_preview=_safe_preview(raw_text, _RAW_TEXT_PREVIEW_CHARS),
        )

    proposals: list[SummaryProposal] = []
    for raw in raw_proposals:
        if not isinstance(raw, dict):
            _int_log.warning("Skipping non-object proposal: %r", raw)
            continue
        try:
            cut_ranges_raw = raw.get("cut_ranges") or []
            cut_ranges = [
                SummaryCutRange(start_ms=r["start_ms"], end_ms=r["end_ms"])
                for r in cut_ranges_raw
                if isinstance(r, dict) and "start_ms" in r and "end_ms" in r
            ]
            proposals.append(
                SummaryProposal(
                    proposal_index=int(raw["proposal_index"]),
                    cut_ranges=cut_ranges,
                    reasoning_note=raw.get("reasoning_note"),
                    total_duration_ms=int(raw.get("total_duration_ms", 0) or 0),
                    confidence=raw.get("confidence"),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            _int_log.warning("Skipping malformed proposal: %s raw=%r", exc, raw)

    if not proposals:
        return _summarize_failed_output(
            req,
            "Model output had no parseable proposals",
            ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION,
            raw_text_preview=_safe_preview(raw_text, _RAW_TEXT_PREVIEW_CHARS),
        )

    _int_log.info(
        "SUMMARIZE success correlation_id=%s proposals=%d input_tokens=%d output_tokens=%d",
        req.correlation_id,
        len(proposals),
        result.usage.input_tokens if result.usage else 0,
        result.usage.output_tokens if result.usage else 0,
    )

    return SummarizeResponse(
        correlation_id=req.correlation_id,
        status="COMPLETED",
        proposals=proposals,
        usage=result.usage,
    )
