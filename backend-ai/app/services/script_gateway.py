"""Script-first summarization gateway (SRS v1.2+, System_Architecture §7.2)."""
from __future__ import annotations

import logging
import re

from app.api.structured import parse_json_object
from app.core.config import settings
from app.core.prompts import build_script_summarize_prompt
from app.schemas.contract import Usage
from app.schemas.script import (
    ScriptRefineRequest,
    ScriptSegment,
    ScriptSummarizeRequest,
    ScriptSummarizeResponse,
)
from app.services.llm_gateway import chat, text_reasoning_extra
from app.services.provider_errors import ProviderErrorCode, ProviderException
from app.services.summary.coverage_plan import Sentence, plan_coverage
from app.services.summary.narration_fill import NarrationSlot, fill_narration, join_narration
from app.services.summary.script_timeline import (
    DurationUnreachable,
    TimelineSegment,
    fit_to_window,
    total_ms,
)

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


def _failed(
    req: ScriptSummarizeRequest | ScriptRefineRequest,
    message: str,
    code: str | None = None,
    *,
    error: ProviderException | None = None,
) -> ScriptSummarizeResponse:
    if error is None:
        try:
            error_code = ProviderErrorCode(code) if code else ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION
        except ValueError:
            error_code = ProviderErrorCode.PROVIDER_UNKNOWN
        error = ProviderException(
            error_code,
            message,
            provider=req.provider.base_url,
            protocol=req.provider.protocol,
            capability="TEXT",
            model=req.provider.model,
        )
    detail = error.to_error_detail()
    detail["protocol"] = detail.get("protocol") or req.provider.protocol
    detail["capability"] = detail.get("capability") or "TEXT"
    detail["model"] = detail.get("model") or req.provider.model
    return ScriptSummarizeResponse(
        correlation_id=req.correlation_id,
        status="FAILED",
        error=error.message,
        error_detail=detail,
    )


def _requested_duration(req: ScriptSummarizeRequest | ScriptRefineRequest) -> int:
    # Spring owns the short-source fallback (it clamps the request to the real
    # media duration, like the narrative gateway). The transcript end is not a
    # safe proxy: a truncated STT result would shrink the window to seconds.
    if req.requested_duration_seconds:
        return req.requested_duration_seconds
    transcript_end = max((segment.end_ms for segment in req.transcript), default=60_000)
    return max(1, round(transcript_end / 2000))


class _OutputViolation(Exception):
    """Model output broke the script contract; ``repairable`` says whether re-asking can help."""

    def __init__(self, message: str, code: ProviderErrorCode, *, repairable: bool = True) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.repairable = repairable


def _first(payload: dict, *keys: str):
    for key in keys:
        value = payload.get(key)
        if value not in (None, "", []):
            return value
    return None


def _as_ms(value) -> int | None:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _as_refs(value) -> list[str]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    return [str(item).strip() for item in items if str(item).strip()]


def _verbatim_excerpt(excerpt: str, script: str) -> str | None:
    """Return the excerpt as it appears in ``script``, tolerating whitespace drift."""
    stripped = excerpt.strip()
    if not stripped:
        return None
    if stripped in script:
        return stripped
    words = stripped.split()
    match = re.search(r"\s+".join(re.escape(word) for word in words), script)
    return match.group(0) if match else None


def _ref_span(refs: list[str], sentences: list[tuple[int, int]]) -> tuple[int, int] | None:
    spans = [sentences[int(ref)] for ref in refs if ref.isdigit() and int(ref) < len(sentences)]
    if not spans:
        return None
    return min(start for start, _ in spans), max(end for _, end in spans)


def _timeline_segments(raw_segments, script: str, sentences: list[tuple[int, int]]) -> list[TimelineSegment]:
    """Coerce provider-specific segment shapes; drop entries that cannot be grounded."""
    segments: list[TimelineSegment] = []
    for item in raw_segments if isinstance(raw_segments, list) else []:
        if not isinstance(item, dict):
            continue
        excerpt = _verbatim_excerpt(str(_first(item, "script_excerpt", "excerpt", "text") or ""), script)
        if excerpt is None:
            continue
        refs = _as_refs(_first(item, "source_sentence_refs", "sentence_refs", "refs"))
        start, end = _as_ms(item.get("start_ms")), _as_ms(item.get("end_ms"))
        if start is None or end is None or end <= start:
            span = _ref_span(refs, sentences)
            if span is None:
                continue
            start, end = span
        note = item.get("reasoning_note")
        segments.append(TimelineSegment(start, end, excerpt, refs, str(note) if note is not None else None))
    return segments


def _confidence(value) -> float | None:
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return None


def _parse_response(
    req: ScriptSummarizeRequest | ScriptRefineRequest, raw: str, usage
) -> tuple[ScriptSummarizeResponse, list[TimelineSegment]]:
    try:
        payload = parse_json_object(raw)
    except ValueError as exc:
        raise _OutputViolation(
            "Model output did not match the script contract", ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED
        ) from exc

    script = _first(payload, "script_content", "script", "summary_script", "content")
    script = script.strip() if isinstance(script, str) else ""
    sentences = [(segment.start_ms, segment.end_ms) for segment in req.transcript]
    segments = _timeline_segments(_first(payload, "segments", "matched_segments", "clips"), script, sentences)
    if not script or not segments:
        raise _OutputViolation(
            "Model returned an empty script or no matched video segments",
            ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION,
        )

    requested_ms = _requested_duration(req) * 1000
    before_ms = total_ms(segments)
    model_ranges = [(s.start_ms, s.end_ms) for s in segments]
    # Section coverage is deterministic (as the original allocator): the model's
    # matches only anchor footage inside chronological blocks of the whole video.
    segments = plan_coverage(
        segments,
        [Sentence(s.start_ms, s.end_ms, s.text or "") for s in req.transcript],
        requested_ms,
    )
    try:
        segments, _ = fit_to_window(segments, sentences, requested_ms)
    except DurationUnreachable as exc:
        raise _OutputViolation(
            str(exc), ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION, repairable=False
        ) from exc
    adjusted = model_ranges != [(s.start_ms, s.end_ms) for s in segments]
    _log.info(
        "Script summary coverage correlation_id=%s model=%s model_segments=%d sections=%d "
        "covered_span_ms=%d-%d source_extent_ms=%d",
        req.correlation_id,
        req.provider.model,
        len(model_ranges),
        len(segments),
        segments[0].start_ms,
        segments[-1].end_ms,
        max((end for _, end in sentences), default=0),
    )

    warnings = [str(w) for w in payload.get("warnings") or [] if isinstance(w, (str, int, float))]
    if adjusted:
        warnings.append("DURATION_NORMALIZED")
        _log.info(
            "Script summary footage fitted correlation_id=%s model=%s requested_ms=%d model_ms=%d fitted_ms=%d",
            req.correlation_id,
            req.provider.model,
            requested_ms,
            before_ms,
            total_ms(segments),
        )
    reasoning = payload.get("reasoning_note")
    parsed = ScriptSummarizeResponse(
        correlation_id=req.correlation_id,
        status="COMPLETED",
        script_content=script,
        script_language=str(payload.get("script_language") or req.target_lang),
        reasoning_note=reasoning if isinstance(reasoning, str) else None,
        confidence=_confidence(payload.get("confidence")),
        warnings=warnings,
        usage=usage,
    )
    # Coverage beats may still lack narration; _fit_narration writes it before segments are built.
    return parsed, segments


def _safe_preview(text: str, limit: int = 600) -> str:
    """Truncated raw output for diagnostics; never echoes key-like tokens."""
    cleaned = re.sub(r"\b(sk|nvapi)-[A-Za-z0-9_-]+", "***", text or "")
    return cleaned if len(cleaned) <= limit else cleaned[:limit] + f"...<truncated {len(cleaned) - limit} chars>"


def _merge_usage(total: Usage | None, usage) -> Usage | None:
    """Sum token usage across repair attempts so Spring charges every provider call."""
    if usage is None:
        return total
    if total is None:
        return usage
    return Usage(
        input_tokens=(total.input_tokens or 0) + (getattr(usage, "input_tokens", 0) or 0),
        output_tokens=(total.output_tokens or 0) + (getattr(usage, "output_tokens", 0) or 0),
        provider=total.provider or getattr(usage, "provider", None),
        model=total.model or getattr(usage, "model", None),
    )


# Global default used by the original narrative writer when no voice calibration exists.
DEFAULT_NARRATION_CPS = 14.0
NARRATION_TOLERANCE = 0.10


def _narration_cps(req: ScriptSummarizeRequest | ScriptRefineRequest) -> float:
    return req.narration_cps or DEFAULT_NARRATION_CPS


def _narration_chars(response: ScriptSummarizeResponse) -> int:
    """TTS reads the excerpts, so they - not script_content - are the narration."""
    return sum(len(segment.script_excerpt.strip()) for segment in response.segments)


def _slot_source(req: ScriptSummarizeRequest | ScriptRefineRequest, start_ms: int, end_ms: int) -> list[str]:
    return [
        segment.text.strip() for segment in req.transcript
        if segment.text and segment.start_ms < end_ms and segment.end_ms > start_ms
    ]


async def _fit_narration(req: ScriptSummarizeRequest | ScriptRefineRequest,
                         parsed: ScriptSummarizeResponse,
                         timeline: list[TimelineSegment],
                         usage: Usage | None) -> ScriptSummarizeResponse:
    """Budget each fitted footage segment's narration so the voice fills the requested duration."""
    cps = _narration_cps(req)
    slots = [
        NarrationSlot(s.start_ms, s.end_ms, s.script_excerpt.strip(), _slot_source(req, s.start_ms, s.end_ms))
        for s in timeline
    ]
    before = sum(len(slot.text) for slot in slots)
    warnings = list(parsed.warnings)
    try:
        extra = await fill_narration(
            slots, provider=req.provider, target_lang=req.target_lang, cps=cps,
            visual_context=req.visual_context, correlation_id=req.correlation_id,
        )
        usage = _merge_usage(usage, extra)
    except ProviderException as exc:
        # The draft is still a valid proposal; measured TTS and render pacing absorb the gap.
        _log.warning("Narration fill degraded correlation_id=%s errorCode=%s", req.correlation_id, exc.code.value)
        warnings.append("NARRATION_FILL_DEGRADED")
    target = round(_requested_duration(req) * cps)
    after = sum(len(slot.text) for slot in slots)
    miss = abs(after - target) / target if target else 0.0
    _log.info(
        "Script narration fitted correlation_id=%s model=%s narration_cps=%.2f target_chars=%d "
        "draft_chars=%d final_chars=%d miss=%.0f%%",
        req.correlation_id, req.provider.model, cps, target, before, after, miss * 100,
    )
    if miss > NARRATION_TOLERANCE:
        warnings.append("NARRATION_LENGTH_RESIDUAL")
    # A coverage beat with no draft stays empty only if every writer call failed;
    # footage without narration cannot be voiced, so it is left out.
    narrated = [
        TimelineSegment(t.start_ms, t.end_ms, slot.text.strip(), list(t.source_sentence_refs), t.reasoning_note)
        for t, slot in zip(timeline, slots)
        if slot.text.strip()
    ]
    if not narrated:
        raise ProviderException(
            ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
            "Model returned no narration for the summary sections",
            provider=req.provider.base_url,
            protocol=req.provider.protocol,
            capability="TEXT",
            model=req.provider.model,
        )
    if len(narrated) < len(slots):
        warnings.append("SECTIONS_WITHOUT_NARRATION_DROPPED")
        try:
            narrated, _ = fit_to_window(
                narrated, [(t.start_ms, t.end_ms) for t in req.transcript], _requested_duration(req) * 1000)
        except DurationUnreachable:
            pass  # keep the narrated beats; Spring validates the final window
    segments = [
        ScriptSegment(
            start_ms=t.start_ms,
            end_ms=t.end_ms,
            script_excerpt=t.script_excerpt,
            source_sentence_refs=t.source_sentence_refs,
            reasoning_note=t.reasoning_note,
        )
        for t in narrated
    ]
    return parsed.model_copy(update={
        "script_content": join_narration([segment.script_excerpt for segment in segments], req.target_lang),
        "segments": segments,
        "warnings": list(dict.fromkeys(warnings)),
        "usage": usage,
    })


def _repair_prompt(user: str, violation: str) -> str:
    return (
        f"{user}\n\n<previous_attempt_violation>{violation}</previous_attempt_violation>\n"
        "Your previous answer was rejected for the violation above. Return a corrected JSON object "
        "that satisfies every rule: script_content must be non-empty, each script_excerpt must be "
        "copied verbatim from script_content, and every segment must have end_ms > start_ms inside "
        "the transcript timeline."
    )


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
        narration_cps=_narration_cps(req),
    )
    # Footage duration is fitted deterministically in _parse_response, so the
    # model's arithmetic never decides success. Only contract breaks the model
    # can fix (malformed JSON, empty script, ungroundable segments) go through
    # the bounded repair loop. Provider/transport failures return immediately
    # so Spring's retry policy stays authoritative.
    attempts = 1 + max(0, settings.script_output_repair_attempts)
    usage: Usage | None = None
    violation: str | None = None
    response: ScriptSummarizeResponse | None = None
    for attempt in range(attempts):
        prompt = user if violation is None else _repair_prompt(user, violation)
        try:
            result = await chat(
                req.provider,
                system,
                prompt,
                max_tokens=settings.summarize_max_tokens,
                response_format={"type": "json_object"},
                extra_body=text_reasoning_extra(req.provider, disabled=settings.disable_thinking_for_summarize),
            )
        except ProviderException as exc:
            return _failed(req, exc.message, error=exc)
        usage = _merge_usage(usage, result.usage)
        try:
            parsed, timeline = _parse_response(req, result.text or "", usage)
        except _OutputViolation as exc:
            response = _failed(req, exc.message, exc.code.value)
            _log.warning(
                "Script summary output rejected correlation_id=%s model=%s attempt=%d/%d errorCode=%s "
                "repairable=%s violation=%s raw_preview=%r",
                req.correlation_id,
                req.provider.model,
                attempt + 1,
                attempts,
                exc.code.value,
                exc.repairable,
                exc.message,
                _safe_preview(result.text or ""),
            )
            if not exc.repairable:
                return response
            violation = exc.message
            continue
        # The footage is fitted; narration length is budgeted per segment, which
        # converges where whole-script "expand" repairs keep shrinking the text.
        try:
            return await _fit_narration(req, parsed, timeline, usage)
        except ProviderException as exc:
            return _failed(req, exc.message, error=exc)
    assert response is not None
    return response


async def summarize_script(req: ScriptSummarizeRequest) -> ScriptSummarizeResponse:
    return await _run(req)


async def refine_script(req: ScriptRefineRequest) -> ScriptSummarizeResponse:
    return await _run(req, previous_script=req.previous_script, feedback_text=req.feedback_text)
