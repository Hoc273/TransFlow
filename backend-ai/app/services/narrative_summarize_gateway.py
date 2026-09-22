"""Staged NARRATIVE_REVIEW gateway (CT5.7).

AI owns semantic planning and narrative writing. Runtime owns deterministic
whole-block duration allocation and source-ref expansion.
"""
from __future__ import annotations

from app.core.config import settings
from app.core.logging_config import get_internal_logger, get_provider_logger
from app.core.prompts import (
    build_narrative_multimodal_writer_prompt,
    build_narrative_semantic_plan_prompt,
    build_narrative_writer_prompt,
)
from app.schemas.contract import (
    NarrativePlanModel,
    NarrativeSectionModel,
    NarrativeSourceRef,
    NarrativeSummarizeRequest,
    NarrativeSummarizeResponse,
    Usage,
)
from app.services.allocator import (
    AllocationError,
    allocate_blocks,
    compute_effective_coverage_ms,
    duration_window,
    is_bridged_gap,
    chronology_coverage_metrics,
    source_coverage_target_representable,
)
from app.services.llm_gateway import chat, text_reasoning_extra
from app.services.sentence_splitter import split_sentences
from app.services.narrative_planning_models import (
    AllocatedSection,
    BlockSegment,
    NarrativeDraft,
    SemanticPlan,
    SemanticSection,
    BlockRanking,
    TranscriptBlock,
    WrittenSection,
)
from app.services.planner import (
    PlanningOutputError,
    parse_narrative_draft,
    parse_narrative_repair,
    parse_semantic_plan,
)
from app.services.protocol.types import ChatResult
from app.services.summary.beat_grounding import (
    NARRATION_TARGET_CPS,
    VISUAL_GROUNDING_DEGRADED_WARNING,
    find_sections_without_visual_coverage,
    narration_target_chars,
    rewrite_section_refs_from_candidates,
    split_oversized_sections_at_silence,
)
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderException,
    ProviderValidation,
)
from app.services.timing_boundaries import SILENCE_BOUNDARY_MS

_int_log = get_internal_logger("narrative_summarize")
_prov_log = get_provider_logger("narrative_summarize")

_PROMPT_PREVIEW_CHARS = 1200
_RAW_TEXT_PREVIEW_CHARS = 800
_MODEL_NAME_PREVIEW_CHARS = 200
_BLOCK_TARGET_MS = 45_000
_BLOCK_MIN_MS = 30_000
_BLOCK_MAX_MS = 75_000
_BLOCK_PREVIEW_CHARS = 240
_JSON_MODE_PROTOCOLS = {"openai_compatible", "dashscope_native"}
# Semantic planning is intentionally much smaller than the final presentation
# plan. Boundary-driven splitting may produce any number of presentation beats.
_SEMANTIC_ARC_BUDGET = 12
_SINGLE_PLAN_TARGET_BEAT_MS = 6000
_WRITER_BATCH_SIZE = 12
_MAX_QUALITY_REPAIR_ROUNDS = 2
_SHORTER_THAN_REQUESTED_WARNING = "SHORTER_THAN_REQUESTED"


def _resolve_beat_budget(target_duration_ms: int | None, max_sections: int | None) -> int:
    """Legacy pacing helper; no longer used as a product cap by the gateway."""
    if max_sections is not None and int(max_sections) > 0:
        return max(1, int(max_sections))
    if target_duration_ms is None or int(target_duration_ms) <= 0:
        return 1
    return max(1, round(int(target_duration_ms) / _SINGLE_PLAN_TARGET_BEAT_MS))


def _resolve_semantic_arc_budget(max_sections: int | None) -> int:
    """Resolve the internal story-arc budget, separate from presentation beats."""
    if max_sections is not None and int(max_sections) > 0:
        return max(1, int(max_sections))
    return _SEMANTIC_ARC_BUDGET

_NON_RETRYABLE_OUTPUT_CODES = {
    ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
    ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
    ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION,
}


def _force_non_retryable(detail: dict) -> dict:
    if detail.get("errorCode") in {code.value for code in _NON_RETRYABLE_OUTPUT_CODES}:
        return {**detail, "retryable": False}
    return detail


def _safe_preview(text: str | None, limit: int) -> str:
    if text is None:
        return ""
    cleaned = text.replace("sk-", "***").replace("nvapi-", "***")
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit] + f"...<truncated {len(cleaned) - limit} chars>"


def _safe_prompt_preview(text: str | None, limit: int) -> str:
    """Preview prompt structure without logging generated narration contents."""
    if text is None:
        return ""
    redacted = text
    for tag in (
        "current_script",
        "current_target_text",
        "duplicate_sentence",
        "verbatim_span",
    ):
        opening = f"<{tag}>"
        closing = f"</{tag}>"
        cursor = 0
        while True:
            start = redacted.find(opening, cursor)
            if start < 0:
                break
            content_start = start + len(opening)
            end = redacted.find(closing, content_start)
            if end < 0:
                redacted = redacted[:content_start] + "<redacted>"
                break
            redacted = redacted[:content_start] + "<redacted>" + redacted[end:]
            cursor = content_start + len("<redacted>") + len(closing)
    return _safe_preview(redacted, limit)


def _failed(
    req: NarrativeSummarizeRequest,
    message: str,
    code: ProviderErrorCode,
    raw_text_preview: str = "",
) -> NarrativeSummarizeResponse:
    err = ProviderValidation(message, code=code)
    detail = _force_non_retryable(err.to_error_detail())
    _int_log.warning(
        "NARRATIVE_SUMMARIZE failed output code=%s retryable=%s reason=%s raw_preview=%r",
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
    return NarrativeSummarizeResponse(
        correlation_id=req.correlation_id,
        status="FAILED",
        error=message,
        error_detail=detail,
    )


def _build_transcript_blocks(transcript: list[dict]) -> list[TranscriptBlock]:
    """Group timed transcript segments without fabricating timing for their text."""
    if not transcript:
        return []

    grouped: list[list[dict]] = []
    current: list[dict] = []
    for segment in transcript:
        if not current:
            current = [segment]
            continue
        current_start = int(current[0]["start_ms"])
        coverage_end = max(int(item["end_ms"]) for item in current)
        candidate_end = max(coverage_end, int(segment["end_ms"]))
        candidate_span = candidate_end - current_start
        current_span = coverage_end - current_start
        gap_ms = int(segment["start_ms"]) - coverage_end
        can_split = gap_ms >= 0
        # A canonical block boundary is a context-grouping decision. Only a
        # meaningful silence is a presentation discontinuity; short pauses
        # remain eligible for the target/min/max block sizing below.
        if can_split and gap_ms >= SILENCE_BOUNDARY_MS:
            grouped.append(current)
            current = [segment]
            continue
        if can_split and current_span >= _BLOCK_MIN_MS and candidate_span > _BLOCK_MAX_MS:
            grouped.append(current)
            current = [segment]
        elif can_split and candidate_span > _BLOCK_TARGET_MS:
            keep_distance = abs(current_span - _BLOCK_TARGET_MS)
            add_distance = abs(candidate_span - _BLOCK_TARGET_MS)
            if current_span >= _BLOCK_MIN_MS and keep_distance <= add_distance:
                grouped.append(current)
                current = [segment]
            else:
                current.append(segment)
        else:
            current.append(segment)
    if current:
        grouped.append(current)

    if len(grouped) >= 2:
        tail = grouped[-1]
        tail_end = max(int(segment["end_ms"]) for segment in tail)
        merged_end = max(
            int(segment["end_ms"])
            for group in grouped[-2:]
            for segment in group
        )
        previous_end = max(int(segment["end_ms"]) for segment in grouped[-2])
        tail_gap = int(tail[0]["start_ms"]) - previous_end
        tail_span = tail_end - int(tail[0]["start_ms"])
        merged_span = merged_end - int(grouped[-2][0]["start_ms"])
        if (
            tail_gap < SILENCE_BOUNDARY_MS
            and tail_span < _BLOCK_MIN_MS
            and merged_span <= _BLOCK_MAX_MS
        ):
            grouped[-2].extend(grouped.pop())

    blocks: list[TranscriptBlock] = []
    for index, segments in enumerate(grouped, start=1):
        start_ms = int(segments[0]["start_ms"])
        end_ms = max(int(segment["end_ms"]) for segment in segments)
        full_text = " ".join(str(seg.get("text") or "").strip() for seg in segments).strip()
        preview = full_text
        if len(preview) > _BLOCK_PREVIEW_CHARS:
            preview = preview[:_BLOCK_PREVIEW_CHARS].rstrip() + "..."
        blocks.append(
            TranscriptBlock(
                block_id=f"B{index:03d}",
                start_ms=start_ms,
                end_ms=end_ms,
                duration_ms=end_ms - start_ms,
                text_preview=preview,
                ordered_index=index,
                full_text=full_text,
                segments=[
                    BlockSegment(
                        text=str(seg.get("text") or "").strip(),
                        start_ms=int(seg.get("start_ms") or 0),
                        end_ms=int(seg.get("end_ms") or 0),
                    )
                    for seg in segments
                ],
            )
        )
    return blocks


def _request_source_duration_ms(req: NarrativeSummarizeRequest) -> int:
    request_duration = int(getattr(req, "duration_ms", 0) or 0)
    if request_duration > 0:
        return request_duration
    return max(
        (int(segment.end_ms) for segment in (getattr(req, "transcript", None) or [])),
        default=0,
    )


def _source_shorter_than_target(req: NarrativeSummarizeRequest) -> bool:
    target_duration_ms = getattr(req, "target_duration_ms", None)
    return (
        target_duration_ms is not None
        and int(target_duration_ms) > 0
        and 0 < _request_source_duration_ms(req) < int(target_duration_ms)
    )


def _effective_narration_target_ms(
    req: NarrativeSummarizeRequest,
    selected_coverage_ms: int,
) -> int | None:
    """Use grounded fallback coverage for writer pacing on short sources."""
    if _source_shorter_than_target(req) and int(selected_coverage_ms) > 0:
        return int(selected_coverage_ms)
    return getattr(req, "target_duration_ms", None)


def _build_finer_allocation_units(
    blocks: list[TranscriptBlock],
) -> tuple[list[TranscriptBlock], dict[str, str]]:
    """Split canonical context blocks into timed STT allocation units when useful.

    Semantic planning continues to consume ``blocks``. The returned units are
    only for deterministic duration allocation and inherit their canonical
    parent's ranking after the semantic plan is parsed.
    """
    raw_units: list[tuple[TranscriptBlock, str]] = []
    split_any = False
    for block in blocks:
        segments = list(block.segments or [])
        if len(segments) <= 1:
            raw_units.append((block, block.block_id))
            continue
        previous_end_ms = -1
        overlapping_segments = False
        for segment in segments:
            start_ms = int(segment.start_ms)
            end_ms = int(segment.end_ms)
            if end_ms <= start_ms or start_ms < previous_end_ms:
                overlapping_segments = True
                break
            previous_end_ms = end_ms
        if overlapping_segments:
            raw_units.append((block, block.block_id))
            continue
        split_any = True
        for segment_index, segment in enumerate(segments, start=1):
            start_ms = int(segment.start_ms)
            end_ms = int(segment.end_ms)
            if end_ms <= start_ms:
                continue
            text = str(segment.text or "").strip()
            preview = text
            if len(preview) > _BLOCK_PREVIEW_CHARS:
                preview = preview[:_BLOCK_PREVIEW_CHARS].rstrip() + "..."
            unit = TranscriptBlock(
                block_id=f"{block.block_id}.T{segment_index:03d}",
                start_ms=start_ms,
                end_ms=end_ms,
                duration_ms=end_ms - start_ms,
                text_preview=preview,
                ordered_index=0,
                full_text=text,
                segments=[segment],
            )
            raw_units.append((unit, block.block_id))
        if not any(parent_id == block.block_id for _, parent_id in raw_units[-len(segments):]):
            raw_units.append((block, block.block_id))

    if not split_any or len(raw_units) <= len(blocks):
        return blocks, {block.block_id: block.block_id for block in blocks}

    units: list[TranscriptBlock] = []
    parent_by_unit: dict[str, str] = {}
    for ordered_index, (unit, parent_id) in enumerate(raw_units, start=1):
        normalized = unit.model_copy(update={"ordered_index": ordered_index})
        units.append(normalized)
        parent_by_unit[normalized.block_id] = parent_id
    return units, parent_by_unit


def _expand_semantic_plan_to_allocation_units(
    semantic_plan: SemanticPlan,
    allocation_units: list[TranscriptBlock],
    parent_by_unit: dict[str, str],
) -> SemanticPlan:
    ranking_by_parent = {
        ranking.block_id: ranking for ranking in semantic_plan.block_rankings
    }
    expanded_rankings = []
    for unit in allocation_units:
        parent_id = parent_by_unit.get(unit.block_id)
        ranking = ranking_by_parent.get(parent_id or "")
        if ranking is None:
            raise AllocationError(
                f"Fine allocation unit {unit.block_id} has no canonical semantic ranking"
            )
        expanded_rankings.append(
            BlockRanking(
                block_id=unit.block_id,
                importance=ranking.importance,
                section_id=ranking.section_id,
                reason=ranking.reason,
            )
        )

    expanded_sections = []
    for section in semantic_plan.sections:
        preferred = [
            unit.block_id
            for unit in allocation_units
            if parent_by_unit.get(unit.block_id) in set(section.preferred_blocks)
        ]
        expanded_sections.append(
            section.model_copy(update={"preferred_blocks": preferred})
        )
    return semantic_plan.model_copy(update={
        "sections": expanded_sections,
        "block_rankings": expanded_rankings,
    })


def _json_response_format(protocol: str | None) -> dict[str, str] | None:
    return {"type": "json_object"} if protocol in _JSON_MODE_PROTOCOLS else None


def _supports_json_mode_fallback(exc: ProviderException, protocol: str | None) -> bool:
    if protocol != "openai_compatible" or exc.code != ProviderErrorCode.PROVIDER_BAD_REQUEST:
        return False
    message = (exc.message or "").lower()
    return any(marker in message for marker in ("response_format", "json_object", "json mode")) and any(
        marker in message for marker in ("unsupported", "unknown", "invalid parameter")
    )


async def _call_json_stage(
    req: NarrativeSummarizeRequest,
    stage_name: str,
    system: str,
    user: str,
) -> ChatResult:
    _int_log.info(
        "NARRATIVE_SUMMARIZE %s request correlation_id=%s provider=%s protocol=%s model=%s "
        "max_tokens=%s prompt_preview=%r",
        stage_name,
        req.correlation_id,
        req.provider.base_url,
        req.provider.protocol,
        _safe_preview(req.provider.model, _MODEL_NAME_PREVIEW_CHARS),
        settings.narrative_summarize_max_tokens,
        _safe_prompt_preview(user, _PROMPT_PREVIEW_CHARS),
    )
    extra_body = text_reasoning_extra(
        req.provider,
        disabled=settings.disable_thinking_for_summarize,
    )
    response_format = _json_response_format(req.provider.protocol)
    try:
        result = await chat(
            req.provider,
            system,
            user,
            max_tokens=settings.narrative_summarize_max_tokens,
            response_format=response_format,
            extra_body=extra_body,
        )
    except ProviderException as exc:
        if not _supports_json_mode_fallback(exc, req.provider.protocol):
            raise
        _int_log.warning(
            "NARRATIVE_SUMMARIZE %s JSON mode unsupported; retrying without response_format "
            "correlation_id=%s protocol=%s model=%s",
            stage_name,
            req.correlation_id,
            req.provider.protocol,
            _safe_preview(req.provider.model, _MODEL_NAME_PREVIEW_CHARS),
        )
        result = await chat(
            req.provider,
            system,
            user,
            max_tokens=settings.narrative_summarize_max_tokens,
            response_format=None,
            extra_body=extra_body,
        )

    raw_text = result.text or ""
    _prov_log.info(
        "NARRATIVE_SUMMARIZE %s provider response correlation_id=%s protocol=%s model=%s "
        "text_len=%d finish_reason=%s output_tokens=%d preview=%r",
        stage_name,
        req.correlation_id,
        req.provider.protocol,
        req.provider.model,
        len(raw_text),
        result.finish_reason,
        result.usage.output_tokens if result.usage else 0,
        _safe_preview(raw_text, _RAW_TEXT_PREVIEW_CHARS),
        extra={
            "provider": req.provider.base_url,
            "protocol": req.provider.protocol,
            "capability": "SUMMARIZE",
        },
    )
    if (result.finish_reason or "").lower() == "length":
        output_tokens = result.usage.output_tokens if result.usage else 0
        raise ProviderValidation(
            f"Provider response truncated during {stage_name} (finish_reason=length, "
            f"output_tokens={output_tokens}, max_tokens={settings.narrative_summarize_max_tokens})",
            code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
        )
    if not raw_text.strip():
        raise ProviderValidation(
            f"Model returned empty output during {stage_name}",
            code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
        )
    return result


def _aggregate_usage(req: NarrativeSummarizeRequest, *results: ChatResult) -> Usage:
    return Usage(
        input_tokens=sum(result.usage.input_tokens for result in results if result.usage),
        output_tokens=sum(result.usage.output_tokens for result in results if result.usage),
        provider=req.provider.protocol,
        model=req.provider.model,
    )


_RECAP_SINGLE_PARAGRAPH_CHARS = 200
_VERBATIM_WORD_WINDOW = 15
_CJK_COPY_RE = None  # lazy-compiled below
_DUP_MIN_SENTENCE_CHARS = 20
_DUP_MAX_ALLOWED = 2
# Render accepts 90%–110% duration, so source-language pacing preflight uses
# the same window as an estimate. It is not a TTS duration contract.
_NARRATION_MIN_RATIO = 0.90
_NARRATION_MAX_RATIO = 1.10
_PACING_ESTIMATE_RESIDUAL_WARNING = (
    "NARRATION_PACING_ESTIMATE_RESIDUAL:estimate_only=true;duration_authority=TTS"
)


def _pacing_estimate_residual_warning(diagnostics: list[dict]) -> str:
    section_ids = ",".join(str(item["section_id"]) for item in diagnostics)
    return f"{_PACING_ESTIMATE_RESIDUAL_WARNING};sections={section_ids}"


def _effective_narration_cps(req: NarrativeSummarizeRequest) -> int:
    """Cold-start pacing rate for the writer. Request hint wins; default is global 14."""
    try:
        hint = getattr(req, "narration_cps_estimate", None)
        if hint is not None and int(hint) > 0:
            return int(hint)
    except (TypeError, ValueError):
        pass
    return NARRATION_TARGET_CPS


def _narration_pacing_targets(
    allocated_sections: list[dict],
    presentation_refs_by_section: dict[str, list[tuple[int, int]]] | None,
    *,
    target_duration_ms: int | None,
    cps: int = NARRATION_TARGET_CPS,
) -> list[dict]:
    """Build writer pacing targets without changing deterministic source coverage."""
    try:
        effective_cps = max(1, int(cps or NARRATION_TARGET_CPS))
    except (TypeError, ValueError):
        effective_cps = NARRATION_TARGET_CPS

    refs_by_section = presentation_refs_by_section or {}
    section_spans: list[tuple[str, int]] = []
    for section in allocated_sections:
        section_id = str(section.get("section_id") or "")
        presentation_refs = refs_by_section.get(section_id)
        if presentation_refs is None:
            presentation_refs = [
                (int(block.get("start_ms", 0)), int(block.get("end_ms", 0)))
                for block in (section.get("blocks") or [])
            ]
        try:
            span_ms = max(
                0,
                sum(int(end_ms) - int(start_ms) for start_ms, end_ms in presentation_refs),
            )
        except (TypeError, ValueError):
            span_ms = 0
        section_spans.append((section_id, span_ms))

    total_presentation_span_ms = sum(span_ms for _, span_ms in section_spans)
    try:
        requested_narration_ms = (
            int(target_duration_ms) if target_duration_ms is not None else None
        )
    except (TypeError, ValueError):
        requested_narration_ms = None

    eligible_indexes = [
        index for index, (_, span_ms) in enumerate(section_spans) if span_ms > 0
    ]
    normalized_to_requested = (
        requested_narration_ms is not None
        and requested_narration_ms > 0
        and total_presentation_span_ms > 0
        and bool(eligible_indexes)
    )
    narration_targets_ms = [span_ms for _, span_ms in section_spans]
    if normalized_to_requested:
        remaining_ms = requested_narration_ms
        aggregate_target_chars = int(
            round(requested_narration_ms * effective_cps / 1000)
        )
        remaining_chars = aggregate_target_chars
        target_chars_by_index = [0] * len(section_spans)
        last_eligible_index = eligible_indexes[-1]
        for index in eligible_indexes:
            if index == last_eligible_index:
                narration_targets_ms[index] = remaining_ms
                target_chars_by_index[index] = remaining_chars
            else:
                allocated_ms = (
                    requested_narration_ms * section_spans[index][1]
                ) // total_presentation_span_ms
                allocated_chars = (
                    aggregate_target_chars * section_spans[index][1]
                ) // total_presentation_span_ms
                narration_targets_ms[index] = allocated_ms
                target_chars_by_index[index] = allocated_chars
                remaining_ms -= allocated_ms
                remaining_chars -= allocated_chars
    else:
        target_chars_by_index = [
            narration_target_chars(narration_target_ms, cps=effective_cps)
            for narration_target_ms in narration_targets_ms
        ]

    return [
        {
            "section_id": section_id,
            "presentation_span_ms": span_ms,
            "narration_target_ms": narration_target_ms,
            "target_chars": target_chars,
            "effective_cps": effective_cps,
            "requested_narration_target_ms": requested_narration_ms,
            "total_presentation_span_ms": total_presentation_span_ms,
            "normalized_to_requested": normalized_to_requested,
        }
        for (section_id, span_ms), narration_target_ms, target_chars in zip(
            section_spans, narration_targets_ms, target_chars_by_index
        )
    ]


def _narration_pacing_diagnostics(
    draft: NarrativeDraft,
    allocated_sections: list[dict],
    *,
    correlation_id: str | None = None,
    cps: int = NARRATION_TARGET_CPS,
    stage: str = "NARRATIVE_WRITING",
    repair_round: int = 0,
    correction_applied: bool = False,
) -> list[dict]:
    """Run source-language pacing preflight; measured TTS remains authoritative."""
    try:
        effective_cps = max(1, int(cps or NARRATION_TARGET_CPS))
    except (TypeError, ValueError):
        effective_cps = NARRATION_TARGET_CPS
    written_by_id = {section.section_id: section for section in draft.sections}
    diagnostics: list[dict] = []
    for allocated in allocated_sections:
        section_id = str(allocated.get("section_id") or "")
        target_chars = int(allocated.get("target_chars") or 0)
        written = written_by_id.get(section_id)
        actual_chars = len((written.script_source_lang if written else "").strip())
        ratio = actual_chars / target_chars if target_chars > 0 else 1.0
        deficit_chars = max(0, target_chars - actual_chars)
        overage_chars = max(0, actual_chars - target_chars)
        if target_chars <= 0 or _NARRATION_MIN_RATIO <= ratio <= _NARRATION_MAX_RATIO:
            pacing_status = "WITHIN_ESTIMATE"
        elif ratio < _NARRATION_MIN_RATIO:
            pacing_status = "UNDERFILL"
        else:
            pacing_status = "OVERFILL"
        diagnostics.append({
            "section_id": section_id,
            "target_chars": target_chars,
            "actual_chars": actual_chars,
            "ratio": ratio,
            "deficit_chars": deficit_chars,
            "overage_chars": overage_chars,
            "acceptable_lower_chars": round(target_chars * _NARRATION_MIN_RATIO),
            "acceptable_upper_chars": round(target_chars * _NARRATION_MAX_RATIO),
            "current_script": (written.script_source_lang if written else "").strip(),
            "pacing_status": pacing_status,
            "estimate_only": True,
            "duration_authority": "TTS",
            "predicted_duration_ms": round(
                actual_chars * 1000 / effective_cps
            ),
        })

    total_target_chars = sum(item["target_chars"] for item in diagnostics)
    total_actual_chars = sum(item["actual_chars"] for item in diagnostics)
    aggregate_ratio = (
        total_actual_chars / total_target_chars if total_target_chars > 0 else 1.0
    )
    for item in diagnostics:
        _int_log.info(
            "NARRATIVE_SUMMARIZE pacing preflight stage=%s correlation_id=%s section_id=%s "
            "target_chars=%d actual_chars=%d ratio=%.3f pacing_status=%s "
            "deficit_chars=%d overage_chars=%d estimate_only=true duration_authority=TTS "
            "predicted_narration_duration_ms=%d repair_round=%d correction_applied=%s",
            stage,
            correlation_id,
            item["section_id"],
            item["target_chars"],
            item["actual_chars"],
            item["ratio"],
            item["pacing_status"],
            item["deficit_chars"],
            item["overage_chars"],
            item["predicted_duration_ms"],
            repair_round,
            correction_applied,
        )
    aggregate_duration_ms = round(
        total_actual_chars * 1000 / effective_cps
    )
    _int_log.info(
        "NARRATIVE_SUMMARIZE pacing aggregate preflight stage=%s correlation_id=%s target_chars=%d "
        "actual_chars=%d ratio=%.3f estimate_only=true duration_authority=TTS "
        "predicted_narration_duration_ms=%d repair_round=%d correction_applied=%s",
        stage,
        correlation_id,
        total_target_chars,
        total_actual_chars,
        aggregate_ratio,
        aggregate_duration_ms,
        repair_round,
        correction_applied,
    )
    return diagnostics


def _pacing_needs_repair(diagnostics: list[dict]) -> bool:
    return any(
        item["target_chars"] > 0
        and not _NARRATION_MIN_RATIO <= item["ratio"] <= _NARRATION_MAX_RATIO
        for item in diagnostics
    )


def _pacing_repair_feedback(diagnostics: list[dict]) -> list[dict]:
    return [
        item
        for item in diagnostics
        if item["target_chars"] > 0
        and not _NARRATION_MIN_RATIO <= item["ratio"] <= _NARRATION_MAX_RATIO
    ]


def _pacing_aggregate_ratio(diagnostics: list[dict]) -> float:
    total_target_chars = sum(int(item.get("target_chars") or 0) for item in diagnostics)
    total_actual_chars = sum(int(item.get("actual_chars") or 0) for item in diagnostics)
    return (
        total_actual_chars / total_target_chars
        if total_target_chars > 0
        else 1.0
    )


def _pacing_aggregate_needs_correction(diagnostics: list[dict]) -> bool:
    ratio = _pacing_aggregate_ratio(diagnostics)
    return not _NARRATION_MIN_RATIO <= ratio <= _NARRATION_MAX_RATIO


def _narrative_duplicate_diagnostics(
    draft: NarrativeDraft,
    allocated_sections: list[dict],
) -> list[dict]:
    """Identify only duplicate sections/sentences that the final validator rejects."""
    import re as _re

    target_chars_by_id = {
        str(item.get("section_id") or ""): int(item.get("target_chars") or 0)
        for item in allocated_sections
    }
    seen_scripts: dict[str, str] = {}
    sentence_counts: dict[str, int] = {}
    diagnostics: list[dict] = []

    for section in draft.sections:
        section_id = section.section_id
        current_script = (section.script_source_lang or "").strip()
        normalized_script = _re.sub(r"\s+", " ", current_script.lower()).strip()
        if normalized_script and normalized_script in seen_scripts:
            diagnostics.append({
                "section_id": section_id,
                "duplicate_kind": "WHOLE_SECTION",
                "duplicate_sentence": current_script,
                "duplicate_with_section_id": seen_scripts[normalized_script],
                "current_script": current_script,
                "target_chars": target_chars_by_id.get(section_id, 0),
            })
        elif normalized_script:
            seen_scripts[normalized_script] = section_id

        for sentence in split_sentences(current_script):
            key = _re.sub(r"\s+", " ", sentence.lower()).strip()
            if len(key) < _DUP_MIN_SENTENCE_CHARS:
                continue
            occurrence = sentence_counts.get(key, 0) + 1
            sentence_counts[key] = occurrence
            if occurrence > _DUP_MAX_ALLOWED:
                diagnostics.append({
                    "section_id": section_id,
                    "duplicate_kind": "EXACT_SENTENCE",
                    "duplicate_sentence": sentence.strip(),
                    "occurrence": occurrence,
                    "current_script": current_script,
                    "target_chars": target_chars_by_id.get(section_id, 0),
                })
    return diagnostics


def _normalized_source_words(text: str | None) -> list[str]:
    import re as _re
    import unicodedata

    normalized = unicodedata.normalize("NFKC", str(text or "")).casefold()
    return _re.findall(r"[\w]+", normalized, flags=_re.UNICODE)


def _longest_source_copy(
    script_words: list[str],
    source_words: list[str],
    minimum_words: int,
) -> tuple[int, int, int] | None:
    """Return (script_start, script_end, run_length) for the longest exact run."""
    if len(script_words) < minimum_words or len(source_words) < minimum_words:
        return None
    source_ngrams: dict[int, set[tuple[str, ...]]] = {}
    for length in range(minimum_words, len(source_words) + 1):
        source_ngrams[length] = {
            tuple(source_words[index:index + length])
            for index in range(len(source_words) - length + 1)
        }
    for length in range(min(len(script_words), len(source_words)), minimum_words - 1, -1):
        ngrams = source_ngrams.get(length, set())
        for start in range(len(script_words) - length + 1):
            if tuple(script_words[start:start + length]) in ngrams:
                return start, start + length, length
    return None


def _narrative_verbatim_diagnostics(
    draft: NarrativeDraft,
    allocated_sections: list[dict],
) -> list[dict]:
    """Find source-copy runs using only the evidence locked to each beat."""
    target_chars_by_id = {
        str(item.get("section_id") or ""): int(item.get("target_chars") or 0)
        for item in allocated_sections
    }
    evidence_by_id = {
        str(item.get("section_id") or ""): " ".join(
            str(block.get("full_text") or "").strip()
            for block in (item.get("blocks") or [])
        ).strip()
        for item in allocated_sections
    }
    diagnostics: list[dict] = []
    for section in draft.sections:
        source_evidence = evidence_by_id.get(section.section_id, "")
        source_words = _normalized_source_words(source_evidence)
        script = (section.script_source_lang or "").strip()
        for sentence in split_sentences(script):
            script_words = _normalized_source_words(sentence)
            match = _longest_source_copy(
                script_words,
                source_words,
                _VERBATIM_WORD_WINDOW,
            )
            if match is None:
                continue
            start, end, run_length = match
            sentence_word_count = max(1, len(script_words))
            clearly_copied = (
                run_length > _VERBATIM_WORD_WINDOW + 5
                or run_length * 100 >= sentence_word_count * 65
            )
            diagnostics.append({
                "section_id": section.section_id,
                "violation": "VERBATIM_SOURCE_COPY",
                "target_chars": target_chars_by_id.get(section.section_id, 0),
                "verbatim_span": " ".join(script_words[start:end]),
                "source_evidence": source_evidence,
                "run_words": run_length,
                "terminal_after_budget": clearly_copied,
                "current_script": script,
                "message": (
                    f"Narrative section {section.section_id} contains an exact source-copy "
                    f"run of {run_length} normalized words"
                ),
            })
            break
    return diagnostics


def _narrative_quality_diagnostics(
    draft: NarrativeDraft,
    allocated_sections: list[dict],
    language: str | None = None,
) -> list[dict]:
    """Collect repairable writer-quality diagnostics for the complete draft."""
    import re as _re

    global _CJK_COPY_RE
    if _CJK_COPY_RE is None:
        _CJK_COPY_RE = _re.compile(r"[\u4e00-\u9fff\u3040-\u30ff]{10,}")

    is_cjk_language = bool(
        language and language.lower().startswith(("zh", "ja", "ko", "cmn", "yue"))
    )
    target_chars_by_id = {
        str(item.get("section_id") or ""): int(item.get("target_chars") or 0)
        for item in allocated_sections
    }
    diagnostics: list[dict] = []
    for section in draft.sections:
        section_id = section.section_id
        script = (section.script_source_lang or "").strip()
        base = {
            "section_id": section_id,
            "target_chars": target_chars_by_id.get(section_id, 0),
            "current_script": script,
        }
        if not script:
            diagnostics.append({
                **base,
                "violation": "EMPTY_SCRIPT",
                "terminal_after_budget": True,
                "message": f"Narrative section {section_id} has empty script",
            })
            continue
        if not is_cjk_language and _CJK_COPY_RE.search(script):
            diagnostics.append({
                **base,
                "violation": "CJK_SOURCE_COPY",
                "terminal_after_budget": True,
                "message": (
                    f"Narrative section {section_id} copies Han/kana source material "
                    "instead of recapping it"
                ),
            })
        sentences = split_sentences(script)
        if not sentences:
            diagnostics.append({
                **base,
                "violation": "SENTENCE_STRUCTURE",
                "terminal_after_budget": True,
                "message": f"Narrative section {section_id} has no sentence structure",
            })
        elif len(sentences) == 1 and len(sentences[0]) > _RECAP_SINGLE_PARAGRAPH_CHARS:
            diagnostics.append({
                **base,
                "violation": "SENTENCE_STRUCTURE",
                "terminal_after_budget": True,
                "message": (
                    f"Narrative section {section_id} is a single huge paragraph "
                    f"({len(sentences[0])} chars); sentence-level recap required"
                ),
            })

    diagnostics.extend(_narrative_duplicate_diagnostics(draft, allocated_sections))
    for item in diagnostics:
        item.setdefault("violation", "DUPLICATE_NARRATION")
        item.setdefault("terminal_after_budget", True)
        item.setdefault(
            "message",
            f"Narrative section {item.get('section_id')} violates narration de-duplication",
        )
    diagnostics.extend(_narrative_verbatim_diagnostics(draft, allocated_sections))
    return diagnostics


def _validate_recap_sentence_structure(
    draft: NarrativeDraft,
    allocation,
    language: str | None = None,
) -> None:
    diagnostics = _narrative_quality_diagnostics(
        draft,
        [section.model_dump() for section in getattr(allocation, "sections", [])],
        language=language,
    )
    terminal = [
        item for item in diagnostics
        if item.get("violation") != "VERBATIM_SOURCE_COPY"
        or item.get("terminal_after_budget")
    ]
    if terminal:
        raise AllocationError(
            str(terminal[0].get("message") or "Narrative quality validation failed")
        )


def split_distant_blocks_into_sections(
    sections: list[AllocatedSection],
    max_gap_ms: int = SILENCE_BOUNDARY_MS,
    max_sections: int | None = None,
) -> list[AllocatedSection]:
    """Ensure distant or skipped canonical ranges are never merged into one section/beat.

    Enforces the Beat Grounding Invariant structurally: a narration unit only
    receives the locked source blocks in its own ordered range. If a section
    contains multiple blocks separated by a gap >= max_gap_ms, or skips a
    canonical block, they are split into distinct sections so narration and
    visual remain coupled. If that continuity split would exceed
    ``max_sections``, it raises ``AllocationError`` instead of merging ranges.
    """
    result: list[AllocatedSection] = []
    sec_counter = 1
    for section in sections:
        if len(section.blocks) <= 1:
            renamed = section.model_copy(update={"section_id": f"S{sec_counter:03d}"})
            result.append(renamed)
            sec_counter += 1
            continue

        clusters: list[list[TranscriptBlock]] = []
        current_cluster: list[TranscriptBlock] = [section.blocks[0]]
        for b in section.blocks[1:]:
            prev = current_cluster[-1]
            gap = b.start_ms - prev.end_ms
            consecutive_block = b.ordered_index == prev.ordered_index + 1
            if consecutive_block and gap < max_gap_ms:
                current_cluster.append(b)
            else:
                clusters.append(current_cluster)
                current_cluster = [b]
        if current_cluster:
            clusters.append(current_cluster)

        if len(clusters) == 1:
            renamed = section.model_copy(update={"section_id": f"S{sec_counter:03d}"})
            result.append(renamed)
            sec_counter += 1
        else:
            for idx, cluster in enumerate(clusters, start=1):
                sub_title = section.title if idx == 1 else f"{section.title} (Part {idx})"
                result.append(
                    AllocatedSection(
                        section_id=f"S{sec_counter:03d}",
                        title=sub_title,
                        goal=section.goal,
                        beat_hint=section.beat_hint,
                        blocks=cluster,
                    )
                )
                sec_counter += 1
    if max_sections is not None:
        cap = max(1, int(max_sections))
        if len(result) > cap:
            raise AllocationError(
                f"Cannot honor max_sections={cap}: continuity split produced {len(result)} sections"
            )
    return result


def _presentation_source_refs(
    sections: list[AllocatedSection],
    refs_by_section: dict[str, list[tuple[int, int]]] | None = None,
    section_for_index: dict[int, str] | None = None,
) -> dict[str, list[tuple[int, int]]]:
    """Return the final render ranges for each beat.

    These refs are render authority, not evidence metadata: backend-main
    merges them (``NarrativePlan.mergedSourceRefs``), derives cut ranges and
    the proposal total duration from them, and materializes footage from
    them. Within a beat, sub-threshold silences between consecutive
    canonical blocks of one ranking section stay merged (same rule as the
    allocator). When a presentation cut separates two allocator-bridged
    blocks into adjacent beats, the bridged silence is deterministically
    assigned to the following beat's first ref (mirroring
    ``_coverage_increment``, which attributes the gap to the later block),
    so no counted coverage is lost to the cut. Gaps >= threshold, skipped
    canonical blocks and cross-ranking-section gaps are never bridged.
    """
    refs_by_section = refs_by_section or {}
    result: dict[str, list[tuple[int, int]]] = {}
    for section in sections:
        sid = str(section.section_id)
        refs = refs_by_section.get(sid)
        if refs is None:
            refs = [
                (int(block.start_ms), int(block.end_ms))
                for block in section.blocks
            ]
        ordered_refs = sorted(
            (int(start), int(end)) for start, end in refs if end > start
        )
        merged: list[list[int]] = []
        for start, end in ordered_refs:
            if merged and start - merged[-1][1] < SILENCE_BOUNDARY_MS:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])
        result[sid] = [(start, end) for start, end in merged]
    if section_for_index is not None:
        _assign_bridged_gaps_across_beats(sections, result, section_for_index)
    return result


def _assign_bridged_gaps_across_beats(
    sections: list[AllocatedSection],
    refs_by_section: dict[str, list[tuple[int, int]]],
    section_for_index: dict[int, str],
) -> None:
    """Attach allocator-bridged silences split across beat boundaries.

    For every boundary between two adjacent beats (list order == canonical
    order by construction of the splits), when the flanking blocks are
    consecutive canonical blocks of one ranking section separated by a
    bridged gap (``0 < gap < SILENCE_BOUNDARY_MS``), extend the following
    beat's first ref backward to the preceding block's end. Mutates the
    ref lists in place. Deterministic: each gap is assigned exactly once, to
    exactly one adjacent ref, creating at most touching (never overlapping)
    ranges.
    """
    for prev_section, cur_section in zip(sections, sections[1:]):
        if not prev_section.blocks or not cur_section.blocks:
            continue
        prev_block = max(
            prev_section.blocks, key=lambda b: (int(b.end_ms), int(b.start_ms))
        )
        cur_block = min(
            cur_section.blocks, key=lambda b: (int(b.start_ms), int(b.end_ms))
        )
        prev_key, cur_key = int(prev_block.ordered_index), int(cur_block.ordered_index)
        if cur_key != prev_key + 1:
            continue
        if prev_key not in section_for_index or (
            section_for_index.get(prev_key) != section_for_index.get(cur_key)
        ):
            continue
        gap_ms = int(cur_block.start_ms) - int(prev_block.end_ms)
        if not is_bridged_gap(gap_ms):
            continue
        cur_refs = refs_by_section.get(str(cur_section.section_id))
        if not cur_refs:
            continue
        first_idx = min(
            range(len(cur_refs)), key=lambda i: (cur_refs[i][0], cur_refs[i][1])
        )
        first_start, first_end = (int(cur_refs[first_idx][0]), int(cur_refs[first_idx][1]))
        if int(prev_block.end_ms) <= first_start:
            cur_refs[first_idx] = (int(prev_block.end_ms), first_end)


def _split_for_presentation(allocation, max_sections: int | None,
                            scene_boundaries_ms: list[int] | None = None,
                            section_for_index: dict[int, str] | None = None):
    """Split allocated sections into final small beats without changing coverage."""
    sections, refs = split_oversized_sections_at_silence(
        allocation.sections,
        max_sections=max_sections,
        scene_boundaries_ms=scene_boundaries_ms,
    )
    return allocation.model_copy(update={"sections": sections}), _presentation_source_refs(
        sections, refs, section_for_index
    )


def _log_coverage_bridge_detail(
    correlation_id: str,
    final_block_items: list[tuple[int, int, int]],
    section_for_index: dict[int, str] | None = None,
) -> None:
    """Debug-level breakdown of bridged silences in the final presentation blocks.

    Lists every adjacent consecutive-canonical pair whose gap the canonical
    helper bridged, so a future nonzero delta can be attributed to exact
    (order_key, gap) pairs instead of DB archaeology. Only logged on the
    invariant-failure path.
    """
    ordered = sorted(final_block_items, key=lambda t: (t[2], t[0], t[1]))
    bridged: list[tuple[int, int, int]] = []
    for (_, prev_end, prev_key), (cur_start, _, cur_key) in zip(ordered, ordered[1:]):
        gap_ms = cur_start - prev_end
        same_section = section_for_index is None or (
            prev_key in section_for_index
            and section_for_index.get(prev_key) == section_for_index.get(cur_key)
        )
        if cur_key == prev_key + 1 and same_section and is_bridged_gap(gap_ms):
            bridged.append((prev_key, cur_key, gap_ms))
    _int_log.debug(
        "NARRATIVE_SUMMARIZE coverage bridges correlation_id=%s bridged_pairs=%d "
        "bridged_gap_ms=%d pairs=%s",
        correlation_id,
        len(bridged),
        sum(gap for _, _, gap in bridged),
        bridged[:25],
    )


def _render_coverage_ms(refs: list[tuple[int, int]]) -> int:
    """Union span of final render refs.

    Mirrors ``NarrativePlan.mergedSourceRefs`` (backend-main): sort by start,
    merge touching/overlapping ranges (``next.start <= cur_end``), sum the
    merged spans. No gap bridging here by design — every silence the
    allocator counted must already sit inside a ref span (assigned by
    :func:`_assign_bridged_gaps_across_beats`); anything else would fabricate
    footage the renderer never claimed.
    """
    ordered = sorted(
        (int(start), int(end)) for start, end in refs if int(end) > int(start)
    )
    total = 0
    cur_start: int | None = None
    cur_end = 0
    for start, end in ordered:
        if cur_start is None:
            cur_start, cur_end = start, end
        elif start <= cur_end:
            cur_end = max(cur_end, end)
        else:
            total += cur_end - cur_start
            cur_start, cur_end = start, end
    if cur_start is not None:
        total += cur_end - cur_start
    return total


def _final_coverages(plan, allocation, section_for_index: dict[int, str]):
    """Coverage numbers the final invariant checks, in one place so tests
    exercise the exact production computation.

    Returns ``(render_coverage_ms, canonical_ms)`` where the render number is
    the union over the actual output ``plan.sections[].source_refs`` (what
    backend-main merges into cut ranges) and the canonical number recomputes
    the same total from the final presentation blocks (internal consistency).
    """
    render_coverage_ms = _render_coverage_ms(
        [
            (int(ref.start_ms), int(ref.end_ms))
            for section in plan.sections
            for ref in section.source_refs
        ]
    )
    canonical_ms = compute_effective_coverage_ms(
        [
            (int(b.start_ms), int(b.end_ms), int(b.ordered_index))
            for section in allocation.sections
            for b in section.blocks
        ],
        section_for_index=section_for_index,
    )
    return render_coverage_ms, canonical_ms


def _build_plan(
    req: NarrativeSummarizeRequest,
    semantic_plan: SemanticPlan,
    allocation,
    draft: NarrativeDraft,
    validate_narrative: bool = True,
    visual_candidates: list[Any] | None = None,
    visual_refs_by_section: dict[str, list[tuple[int, int]]] | None = None,
    visual_grounding_degraded: bool = False,
) -> NarrativePlanModel:
    if validate_narrative:
        _validate_recap_sentence_structure(draft, allocation, language=req.language)
    written_by_id = {section.section_id: section for section in draft.sections}
    sections: list[NarrativeSectionModel] = []
    candidates_by_seq = {}
    if visual_candidates:
        for idx, vc in enumerate(visual_candidates, start=1):
            candidates_by_seq[idx] = vc

    for seq, allocated in enumerate(allocation.sections, start=1):
        written = written_by_id[allocated.section_id]
        # TASK 6: enrich beat with visual description etc.; fallback to heading/conservative defaults
        # 5–8 generate_terms are writer-provided when available, otherwise synthesised from source preview
        generate_terms = list(written.generate_terms or [])
        if not generate_terms:
            # deterministic fallback: derive 5–8 terms from the first block preview words
            words = (allocated.blocks[0].text_preview or "").split()
            base = [w.strip(".,!?;:\"'()").lower() for w in words if len(w) > 3][:8]
            # pad to 5 if too short
            while len(base) < 5:
                base.append(f"visual_{seq}_{len(base)+1}")
            generate_terms = base[:8]
            if len(generate_terms) < 5:
                generate_terms = (generate_terms * 2)[:5]
            generate_terms = generate_terms[:8]
            if len(generate_terms) > 8:
                generate_terms = generate_terms[:8]
            if len(generate_terms) < 5:
                generate_terms = (generate_terms + ["scene","action","detail","moment","highlight"])[:5]
            # ensure 5-8
            if len(generate_terms) < 5:
                generate_terms = ["scene","action","detail","moment","highlight"]
            elif len(generate_terms) > 8:
                generate_terms = generate_terms[:8]
        # ensure 5-8 even for provided but short
        if 0 < len(generate_terms) < 5:
            generate_terms = (generate_terms + ["scene","action","detail","moment","highlight"])[:5]
        if len(generate_terms) > 8:
            generate_terms = generate_terms[:8]

        # The deterministic allocator owns source coverage. Visual candidates
        # enrich this beat's description but never replace its allocated
        # source ranges with short 3-15s windows.
        block_refs = [
            NarrativeSourceRef(start_ms=b.start_ms, end_ms=b.end_ms)
            for b in allocated.blocks
        ] if allocated.blocks else []
        grounded = (visual_refs_by_section or {}).get(allocated.section_id)
        if grounded:
            source_refs = [NarrativeSourceRef(start_ms=s, end_ms=e) for s, e in grounded]
        else:
            source_refs = block_refs

        vc = candidates_by_seq.get(seq)
        if vc is not None:
            vis_desc = written.visual_description or (f"Action: {vc.dominant_action}. {vc.visual_description}" if vc.dominant_action else vc.visual_description) or f"Visual for: {written.script_source_lang[:80]}"
            sec_importance = written.importance if written.importance is not None else vc.importance_score
        else:
            vis_desc = written.visual_description or f"Visual for: {written.script_source_lang[:80]}"
            sec_importance = (
                written.importance
                if written.importance is not None
                else allocated.blocks[0].duration_ms / max(1, sum(b.duration_ms for b in allocated.blocks))
                if allocated.blocks
                else 0.5
            )

        sections.append(
            NarrativeSectionModel(
                seq=seq,
                heading=written.heading or allocated.title,
                source_refs=source_refs,
                script_source_lang=written.script_source_lang,
                beat_type=written.beat_type or allocated.beat_hint,
                notes=written.notes,
                visual_description=vis_desc,
                visual_strategy=written.visual_strategy or "SOURCE_CUT",
                importance=sec_importance,
                generate_terms=generate_terms,
            )
        )
    warnings = list(dict.fromkeys([*semantic_plan.warnings, *draft.warnings]))
    if (
        _source_shorter_than_target(req)
        and _SHORTER_THAN_REQUESTED_WARNING not in warnings
    ):
        warnings.append(_SHORTER_THAN_REQUESTED_WARNING)
    if visual_grounding_degraded and VISUAL_GROUNDING_DEGRADED_WARNING not in warnings:
        warnings.append(VISUAL_GROUNDING_DEGRADED_WARNING)
    return NarrativePlanModel(
        title=draft.title or semantic_plan.title,
        target_duration_ms=req.target_duration_ms,
        sections=sections,
        global_reasoning_note=draft.global_reasoning_note or semantic_plan.reasoning_note,
        confidence=draft.confidence if draft.confidence is not None else semantic_plan.confidence,
        warnings=warnings,
    )


def _chunks(items: list[dict], size: int) -> list[list[dict]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def _section_ranges(section: dict) -> list[tuple[int, int]]:
    return [
        (int(block.get("start_ms", 0)), int(block.get("end_ms", 0)))
        for block in (section.get("blocks") or [])
        if int(block.get("end_ms", 0)) > int(block.get("start_ms", 0))
    ]


def _ranges_overlap(ranges: list[tuple[int, int]], start_ms: int, end_ms: int) -> bool:
    return any(start_ms < end and end_ms > start for start, end in ranges)


def _batch_multimodal_context(
    multimodal_context: dict | None,
    batch: list[dict],
) -> dict | None:
    """Keep visual evidence local to the writer batch; omit global summaries."""
    if not multimodal_context:
        return None
    ranges = [item for section in batch for item in _section_ranges(section)]
    observations = []
    for observation in multimodal_context.get("visual_observations") or []:
        try:
            timestamp = int(observation.get("timestamp", 0))
        except (AttributeError, TypeError, ValueError):
            continue
        if _ranges_overlap(ranges, timestamp, timestamp + 1):
            observations.append(observation)
    scenes = []
    for scene in multimodal_context.get("visual_scenes") or []:
        try:
            start_ms = int(scene.get("start_ms", 0))
            end_ms = int(scene.get("end_ms", 0))
        except (AttributeError, TypeError, ValueError):
            continue
        if _ranges_overlap(ranges, start_ms, end_ms):
            scenes.append(scene)
    boundaries = []
    for boundary in multimodal_context.get("scene_boundaries_ms") or []:
        try:
            boundary_ms = int(boundary)
        except (TypeError, ValueError):
            continue
        if _ranges_overlap(ranges, boundary_ms, boundary_ms + 1):
            boundaries.append(boundary_ms)
    return {
        "visual_observations": observations,
        "visual_scenes": scenes,
        "scene_boundaries_ms": boundaries,
    }


def _batch_beat_visuals(beat_visuals: list[dict] | None, batch: list[dict]) -> list[dict] | None:
    if not beat_visuals:
        return None
    ids = {str(section.get("section_id") or "") for section in batch}
    return [item for item in beat_visuals if str(item.get("section_id") or "") in ids]


def _merge_narrative_drafts(
    drafts: list[NarrativeDraft],
    expected_section_ids: list[str],
) -> NarrativeDraft:
    if not drafts:
        raise PlanningOutputError("Narrative writer returned no batch output")
    written_by_id = {
        section.section_id: section
        for draft in drafts
        for section in draft.sections
    }
    if set(written_by_id) != set(expected_section_ids):
        raise PlanningOutputError(
            "Narrative writer batches did not cover every locked section_id"
        )
    first = drafts[0]
    return first.model_copy(update={
        "sections": [written_by_id[section_id] for section_id in expected_section_ids],
        "warnings": list(dict.fromkeys(
            warning
            for draft in drafts
            for warning in draft.warnings
        )),
    })


async def _call_narrative_writer_batches(
    req: NarrativeSummarizeRequest,
    allocated_dicts: list[dict],
    *,
    language: str | None,
    intent: dict,
    constraints: list[str],
    content_brief: str | None,
    multimodal_context: dict | None,
    beat_visuals: list[dict] | None,
    stage: str,
    repair_feedback: dict[str, list[dict]] | None = None,
    repair_section_ids: set[str] | None = None,
) -> tuple[NarrativeDraft | dict[str, WrittenSection], list[ChatResult]]:
    """Write or repair bounded contiguous beat batches in source order."""
    if repair_section_ids is None:
        batches = _chunks(allocated_dicts, _WRITER_BATCH_SIZE)
    else:
        selected = [
            section for section in allocated_dicts
            if str(section.get("section_id") or "") in repair_section_ids
        ]
        batches = _chunks(selected, _WRITER_BATCH_SIZE)
    if not batches:
        raise PlanningOutputError("Narrative writer has no sections to process")

    results: list[ChatResult] = []
    if repair_section_ids is None:
        drafts: list[NarrativeDraft] = []
        for batch in batches:
            batch_ids = [str(section["section_id"]) for section in batch]
            batch_context = _batch_multimodal_context(multimodal_context, batch)
            batch_visuals = _batch_beat_visuals(beat_visuals, batch)
            if batch_context:
                writer_system, writer_user = build_narrative_multimodal_writer_prompt(
                    batch,
                    language=language,
                    intent=intent,
                    constraints=constraints,
                    content_brief=None,
                    multimodal_context=batch_context,
                    beat_visuals=batch_visuals,
                )
            else:
                writer_system, writer_user = build_narrative_writer_prompt(
                    batch,
                    language=language,
                    intent=intent,
                    constraints=constraints,
                    content_brief=None,
                )
            result = await _call_json_stage(req, stage, writer_system, writer_user)
            results.append(result)
            drafts.append(parse_narrative_draft(result.text, batch_ids))
        return _merge_narrative_drafts(
            drafts,
            [str(section["section_id"]) for section in allocated_dicts],
        ), results

    repaired: dict[str, WrittenSection] = {}
    for batch in batches:
        batch_ids = [str(section["section_id"]) for section in batch]
        feedback = repair_feedback or {}
        batch_context = _batch_multimodal_context(multimodal_context, batch)
        batch_visuals = _batch_beat_visuals(beat_visuals, batch)
        kwargs = {
            "pacing_feedback": [item for item in feedback.get("pacing", [])
                                if item.get("section_id") in batch_ids],
            "duplicate_feedback": [item for item in feedback.get("duplicate", [])
                                   if item.get("section_id") in batch_ids],
            "verbatim_feedback": [item for item in feedback.get("verbatim", [])
                                  if item.get("section_id") in batch_ids],
            "structure_feedback": [item for item in feedback.get("structure", [])
                                    if item.get("section_id") in batch_ids],
        }
        if batch_context:
            writer_system, writer_user = build_narrative_multimodal_writer_prompt(
                batch,
                language=language,
                intent=intent,
                constraints=constraints,
                content_brief=None,
                multimodal_context=batch_context,
                beat_visuals=batch_visuals,
                **kwargs,
            )
        else:
            writer_system, writer_user = build_narrative_writer_prompt(
                batch,
                language=language,
                intent=intent,
                constraints=constraints,
                content_brief=None,
                **kwargs,
            )
        result = await _call_json_stage(req, stage, writer_system, writer_user)
        results.append(result)
        repaired.update(parse_narrative_repair(result.text, batch_ids))
    return repaired, results


def _apply_repaired_sections(
    draft: NarrativeDraft,
    repaired: dict[str, WrittenSection],
) -> NarrativeDraft:
    return draft.model_copy(update={
        "sections": [
            repaired.get(section.section_id, section)
            for section in draft.sections
        ]
    })


def _mock_response(req: NarrativeSummarizeRequest) -> NarrativeSummarizeResponse:
    transcript = [
        {"text": segment.text, "start_ms": segment.start_ms, "end_ms": segment.end_ms}
        for segment in req.transcript
    ]
    blocks = _build_transcript_blocks(transcript)
    if not blocks:
        return _failed(
            req,
            "Narrative planning requires a non-empty timed transcript",
            ProviderErrorCode.PROVIDER_VALIDATION_FAILED,
        )
    semantic_budget = _resolve_semantic_arc_budget(req.max_sections)
    section_count = min(len(blocks), semantic_budget)
    sections = [
        SemanticSection(
            section_id=f"S{index:03d}",
            title="Opening" if index == 1 else "Body",
            goal="Present selected source content",
            beat_hint="HOOK" if index == 1 else "BODY",
        )
        for index in range(1, section_count + 1)
    ]
    plan = SemanticPlan(
        sections=sections,
        block_rankings=[
            BlockRanking(
                block_id=block.block_id,
                importance=max(0.1, 1.0 - (index - 1) * 0.05),
                section_id=sections[min(index - 1, section_count - 1)].section_id,
                reason="Deterministic mock ranking",
            )
            for index, block in enumerate(blocks, start=1)
        ],
        title="Mock narrative",
        confidence=0.8,
    )
    target = req.target_duration_ms or sum(block.duration_ms for block in blocks)
    source_shorter = _source_shorter_than_target(req)
    canonical_representable = source_coverage_target_representable(blocks, target)
    finer_blocks, parent_by_unit = _build_finer_allocation_units(blocks)
    allocation_blocks = blocks
    allocation_plan = plan
    if (
        not source_shorter
        and not canonical_representable
        and finer_blocks is not blocks
        and source_coverage_target_representable(finer_blocks, target)
    ):
        allocation_blocks = finer_blocks
        allocation_plan = _expand_semantic_plan_to_allocation_units(
            plan, finer_blocks, parent_by_unit
        )
    try:
        allocation = allocate_blocks(
            allocation_blocks,
            target,
            allocation_plan,
            allow_fallback=source_shorter,
        )
        # Keep the representation invariant shared with allocation: natural
        # silence below 2000ms remains one continuous source range. The source
        # refs emitted below coalesce that gap instead of silently bridging it.
        split_sections = split_distant_blocks_into_sections(
            allocation.sections,
            max_gap_ms=SILENCE_BOUNDARY_MS,
        )
        allocation = allocation.model_copy(update={"sections": split_sections})
        mock_section_for_index = {
            block.ordered_index: next(
                ranking.section_id
                for ranking in allocation_plan.block_rankings
                if ranking.block_id == block.block_id
            )
            for block in allocation_blocks
        }
        allocation, visual_refs_by_section = _split_for_presentation(
            allocation, None, section_for_index=mock_section_for_index
        )
    except AllocationError as exc:
        return _failed(
            req,
            str(exc),
            ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION,
        )
    visual_obs = getattr(req, "visual_observations", None)
    visual_sc = getattr(req, "visual_scenes", None)
    visual_candidates = None
    visual_grounding_degraded = False
    video_dur_mock = req.duration_ms or (max(s.end_ms for s in req.transcript) if req.transcript else 120000)
    if visual_obs or visual_sc:
        from app.services.summary.visual_candidate_planner import (
            generate_visual_candidates,
            align_visual_candidates_to_sections,
        )
        raw_candidates = generate_visual_candidates(
            visual_observations=visual_obs,
            visual_scenes=visual_sc,
            video_duration_ms=video_dur_mock,
            transcript_segments=[{"text": s.text, "start_ms": s.start_ms, "end_ms": s.end_ms} for s in req.transcript],
            target_candidate_duration_ms=5000,
        )
        if raw_candidates:
            visual_candidates = align_visual_candidates_to_sections(
                raw_candidates,
                target_section_count=len(allocation.sections),
                target_duration_ms=target,
            )
            if find_sections_without_visual_coverage(
                allocation.sections, visual_candidates or raw_candidates, video_dur_mock
            ):
                visual_grounding_degraded = True
        else:
            visual_grounding_degraded = True
    else:
        visual_grounding_degraded = True
    draft = NarrativeDraft(
        title="Mock narrative",
        sections=[
            WrittenSection(
                section_id=section.section_id,
                heading=section.title,
                script_source_lang=f"Mock narration grounded in: {section.blocks[0].text_preview}",
                beat_type=section.beat_hint,
                visual_description=f"Mock visual for {section.title}: {section.blocks[0].text_preview[:60]}",
                visual_strategy="SOURCE_CUT",
                importance=max(0.1, 1.0 - (idx * 0.05)),
                generate_terms=["mock","visual","scene","action","detail","moment","highlight","beat"][:5 + (idx % 4)],
            )
            for idx, section in enumerate(allocation.sections)
        ],
        confidence=0.8,
    )
    return NarrativeSummarizeResponse(
        correlation_id=req.correlation_id,
        status="COMPLETED",
        plans=[_build_plan(req, allocation_plan, allocation, draft, validate_narrative=False, visual_candidates=visual_candidates, visual_refs_by_section=visual_refs_by_section, visual_grounding_degraded=visual_grounding_degraded)],
        usage=None,
    )


async def summarize_narrative(req: NarrativeSummarizeRequest) -> NarrativeSummarizeResponse:
    """Run semantic planning, deterministic allocation, then narrative writing."""
    if settings.mock_mode or not settings.key_is_usable(req.provider.api_key):
        return _mock_response(req)

    transcript = [
        {"text": segment.text, "start_ms": segment.start_ms, "end_ms": segment.end_ms}
        for segment in req.transcript
    ]
    blocks = _build_transcript_blocks(transcript)
    if not blocks:
        return _failed(
            req,
            "Narrative planning requires a non-empty timed transcript",
            ProviderErrorCode.PROVIDER_VALIDATION_FAILED,
        )
    if req.target_duration_ms is None:
        return _failed(
            req,
            "Narrative planning requires target_duration_ms",
            ProviderErrorCode.PROVIDER_VALIDATION_FAILED,
        )

    intent = {
        "goal_type": req.intent.goal_type,
        "tone_style_hints": req.intent.tone_style_hints,
        "target_langs": list(req.intent.target_langs or []),
    }
    content_brief = req.content_brief.strip() if req.content_brief else None
    block_dicts = [block.model_dump() for block in blocks]

    try:
        semantic_budget = _resolve_semantic_arc_budget(req.max_sections)
        _int_log.info(
            "NARRATIVE_SUMMARIZE semantic planning preflight "
            "correlation_id=%s transcript_segment_count=%d "
            "canonical_block_count=%d target_duration_ms=%d semantic_arc_budget=%d",
            req.correlation_id,
            len(req.transcript),
            len(blocks),
            req.target_duration_ms,
            semantic_budget,
        )
        source_shorter = _source_shorter_than_target(req)
        canonical_representable = source_coverage_target_representable(
            blocks, req.target_duration_ms
        )
        finer_blocks, parent_by_unit = _build_finer_allocation_units(blocks)
        finer_representable = (
            finer_blocks is not blocks
            and source_coverage_target_representable(finer_blocks, req.target_duration_ms)
        )
        if not source_shorter and not canonical_representable and not finer_representable:
            min_ms, max_ms = duration_window(req.target_duration_ms)
            message = (
                "source_coverage_target_not_representable: no subset of canonical "
                f"or timed transcript allocation units can cover [{min_ms}, {max_ms}]ms"
            )
            _int_log.warning(
                "%s correlation_id=%s target_duration_ms=%s",
                message,
                req.correlation_id,
                req.target_duration_ms,
            )
            return _failed(
                req,
                message,
                ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION,
            )
        planning_system, planning_user = build_narrative_semantic_plan_prompt(
            block_dicts,
            language=req.language,
            intent=intent,
            constraints=list(req.constraints or []),
            max_sections=semantic_budget,
            content_brief=content_brief,
        )
        planning_result = await _call_json_stage(
            req, "SEMANTIC_PLANNING", planning_system, planning_user
        )
        semantic_plan = parse_semantic_plan(planning_result.text, blocks, semantic_budget)
        _int_log.info(
            "NARRATIVE_SUMMARIZE semantic plan parsed correlation_id=%s "
            "semantic_section_count=%d essential_section_count=%d",
            req.correlation_id,
            len(semantic_plan.sections),
            sum(1 for section in semantic_plan.sections if section.essential),
        )

        allocation_blocks = blocks
        if not source_shorter and not canonical_representable and finer_representable:
            allocation_blocks = finer_blocks
            semantic_plan = _expand_semantic_plan_to_allocation_units(
                semantic_plan, allocation_blocks, parent_by_unit
            )
            _int_log.info(
                "NARRATIVE_SUMMARIZE using timed allocation units "
                "correlation_id=%s canonical_block_count=%d allocation_unit_count=%d",
                req.correlation_id,
                len(blocks),
                len(allocation_blocks),
            )

        allocation = allocate_blocks(
            allocation_blocks,
            req.target_duration_ms,
            semantic_plan,
            allow_fallback=source_shorter,
        )
        split_sections = split_distant_blocks_into_sections(
            allocation.sections,
            max_gap_ms=SILENCE_BOUNDARY_MS,
        )
        allocation = allocation.model_copy(update={"sections": split_sections})
        # Ranking section map for render-range accounting: bridged silences
        # split across beat boundaries are assigned deterministically, using
        # the exact allocator gap rule (same section + consecutive + <2s).
        ranking_by_id = {ranking.block_id: ranking for ranking in semantic_plan.block_rankings}
        section_for_index = {
            block.ordered_index: ranking_by_id[block.block_id].section_id
            for block in allocation_blocks
        }
        # Final presentation beats are fixed BEFORE narration writing: prefer VLM
        # scene boundaries when present, then transcript sentence/silence gaps.
        # One final beat maps to one narration/visual unit downstream.
        _scene_bounds: list[int] = []
        for sc in (getattr(req, "visual_scenes", None) or []):
            try:
                if isinstance(sc, dict):
                    _scene_bounds += [int(sc.get("start_ms", 0)), int(sc.get("end_ms", 0))]
                else:
                    _scene_bounds += [int(getattr(sc, "start_ms", 0)), int(getattr(sc, "end_ms", 0))]
            except (TypeError, ValueError, AttributeError):
                continue
        allocation, visual_refs_by_section = _split_for_presentation(
            allocation, None, scene_boundaries_ms=_scene_bounds or None,
            section_for_index=section_for_index,
        )
        chronology_metrics = chronology_coverage_metrics(
            allocation_blocks,
            allocation.selected_blocks,
            req.target_duration_ms,
            section_for_index=section_for_index,
        )
        _int_log.info(
            "NARRATIVE_SUMMARIZE allocation coverage correlation_id=%s "
            "source_span_ms=%d target_coverage_ms=%d selected_coverage_ms=%d "
            "presentation_units=%d timeline_bucket_count=%d "
            "timeline_buckets_covered=%s largest_uncovered_gap_ms=%d "
            "selected_run_count=%d source_start_ms=%s source_end_ms=%s "
            "selected_first_start_ms=%s selected_last_end_ms=%s "
            "leading_uncovered_ms=%d trailing_uncovered_ms=%d "
            "first_bucket_covered=%s last_bucket_covered=%s",
            req.correlation_id,
            chronology_metrics["source_span_ms"],
            req.target_duration_ms,
            allocation.coverage_ms,
            len(allocation.sections),
            chronology_metrics["timeline_bucket_count"],
            chronology_metrics["timeline_buckets_covered"],
            chronology_metrics["largest_uncovered_gap_ms"],
            chronology_metrics["selected_run_count"],
            chronology_metrics["source_start_ms"],
            chronology_metrics["source_end_ms"],
            chronology_metrics["selected_first_start_ms"],
            chronology_metrics["selected_last_end_ms"],
            chronology_metrics["leading_uncovered_ms"],
            chronology_metrics["trailing_uncovered_ms"],
            chronology_metrics["first_bucket_covered"],
            chronology_metrics["last_bucket_covered"],
            extra={
                "narrativeAllocation": chronology_metrics,
                "narrativeAllocationDiagnostics": {
                    "sourceStartMs": chronology_metrics["source_start_ms"],
                    "sourceEndMs": chronology_metrics["source_end_ms"],
                    "selectedFirstStartMs": chronology_metrics["selected_first_start_ms"],
                    "selectedLastEndMs": chronology_metrics["selected_last_end_ms"],
                    "leadingUncoveredMs": chronology_metrics["leading_uncovered_ms"],
                    "trailingUncoveredMs": chronology_metrics["trailing_uncovered_ms"],
                    "firstBucketCovered": chronology_metrics["first_bucket_covered"],
                    "lastBucketCovered": chronology_metrics["last_bucket_covered"],
                },
            },
        )

        # Beat grounding: VLM enriches already-budgeted presentation beats.
        # It does not replace the allocator's source coverage with short
        # candidate windows.
        multimodal_context = getattr(req, "multimodal_context", None)
        if multimodal_context is None and (getattr(req, "visual_observations", None) or getattr(req, "visual_scenes", None)):
            from app.services.visual.multimodal_context import build_multimodal_context as _build_mc

            multimodal_context = _build_mc(
                [{"text": s.text, "start_ms": s.start_ms, "end_ms": s.end_ms} for s in req.transcript],
                req.visual_observations or [],
                req.visual_scenes or [],
                duration_ms=req.duration_ms,
            )
        visual_obs = getattr(req, "visual_observations", None)
        visual_sc = getattr(req, "visual_scenes", None)
        if multimodal_context is not None:
            if not visual_obs and hasattr(multimodal_context, "visual_observations"):
                visual_obs = multimodal_context.visual_observations
            elif not visual_obs and isinstance(multimodal_context, dict):
                visual_obs = multimodal_context.get("visual_observations")
            if not visual_sc and hasattr(multimodal_context, "visual_scenes"):
                visual_sc = multimodal_context.visual_scenes
            elif not visual_sc and isinstance(multimodal_context, dict):
                visual_sc = multimodal_context.get("visual_scenes")

        video_dur = req.duration_ms or (max(s.end_ms for s in req.transcript) if req.transcript else 120000)
        raw_candidates: list[Any] | None = None
        visual_candidates = None
        visual_grounding_degraded = False
        beat_visuals: list[dict] | None = None
        if visual_obs or visual_sc:
            from app.services.summary.visual_candidate_planner import (
                generate_visual_candidates,
                align_visual_candidates_to_sections,
            )
            raw_candidates = generate_visual_candidates(
                visual_observations=visual_obs,
                visual_scenes=visual_sc,
                video_duration_ms=video_dur,
                transcript_segments=[{"text": s.text, "start_ms": s.start_ms, "end_ms": s.end_ms} for s in req.transcript],
                target_candidate_duration_ms=5000,
            )
            if raw_candidates:
                visual_candidates = align_visual_candidates_to_sections(
                    raw_candidates,
                    target_section_count=len(allocation.sections),
                    target_duration_ms=req.target_duration_ms,
                )
                candidate_refs_by_section = rewrite_section_refs_from_candidates(
                    allocation.sections, visual_candidates or raw_candidates, video_dur
                )
                if find_sections_without_visual_coverage(
                    allocation.sections, visual_candidates or raw_candidates, video_dur
                ):
                    visual_grounding_degraded = True
                # Per-beat grounding for the writer: THIS narration belongs to
                # THIS visual event (range + description + transcript slice).
                beat_visuals = []
                for sec in allocation.sections:
                    sid = sec.section_id
                    refs = candidate_refs_by_section.get(sid, [])
                    desc_parts: list[str] = []
                    for vc in (visual_candidates or raw_candidates or []):
                        try:
                            vs, ve = int(vc.start_ms), int(vc.end_ms)
                        except (AttributeError, TypeError, ValueError):
                            continue
                        if refs and any(vs < r[1] and ve > r[0] for r in refs):
                            d = (getattr(vc, "visual_description", "") or "") + " " + (getattr(vc, "dominant_action", "") or "")
                            if d.strip():
                                desc_parts.append(d.strip())
                    beat_visuals.append({
                        "section_id": sid,
                        "visual_ranges": [{"start_ms": s, "end_ms": e} for s, e in refs],
                        "visual_description": "; ".join(desc_parts[:2])[:500],
                    })
            else:
                visual_grounding_degraded = True
        else:
            visual_grounding_degraded = True

        allocated_dicts = [section.model_dump() for section in allocation.sections]
        # Per-section narration length guidance is proportional to the final
        # presentation beats, but normalizes to the requested narration target
        # when that target is valid. Source coverage remains allocator-owned.
        effective_narration_cps = _effective_narration_cps(req)
        pacing_targets = _narration_pacing_targets(
            allocated_dicts,
            visual_refs_by_section,
            target_duration_ms=_effective_narration_target_ms(
                req, allocation.coverage_ms
            ),
            cps=effective_narration_cps,
        )
        for section_dict, pacing in zip(allocated_dicts, pacing_targets):
            section_dict.update(
                {
                    "presentation_span_ms": pacing["presentation_span_ms"],
                    "narration_target_ms": pacing["narration_target_ms"],
                    "target_chars": pacing["target_chars"],
                    "effective_cps": pacing["effective_cps"],
                }
            )
            _int_log.info(
                "NARRATIVE_SUMMARIZE pacing budget correlation_id=%s section_id=%s "
                "presentation_span_ms=%d narration_target_ms=%d target_chars=%d "
                "effective_cps=%d normalized_to_requested=%s",
                req.correlation_id,
                pacing["section_id"],
                pacing["presentation_span_ms"],
                pacing["narration_target_ms"],
                pacing["target_chars"],
                pacing["effective_cps"],
                pacing["normalized_to_requested"],
            )
        _int_log.info(
            "NARRATIVE_SUMMARIZE pacing budget aggregate correlation_id=%s "
            "total_presentation_span_ms=%d requested_narration_target_ms=%s "
            "aggregate_target_chars=%d effective_cps=%d normalized_to_requested=%s",
            req.correlation_id,
            pacing_targets[0]["total_presentation_span_ms"] if pacing_targets else 0,
            pacing_targets[0]["requested_narration_target_ms"] if pacing_targets else None,
            sum(item["target_chars"] for item in pacing_targets),
            effective_narration_cps,
            bool(pacing_targets and pacing_targets[0]["normalized_to_requested"]),
        )
        writer_output, writer_results = await _call_narrative_writer_batches(
            req,
            allocated_dicts,
            language=req.language,
            intent=intent,
            constraints=list(req.constraints or []),
            content_brief=content_brief,
            multimodal_context=multimodal_context,
            beat_visuals=beat_visuals,
            stage="NARRATIVE_WRITING",
        )
        if not isinstance(writer_output, NarrativeDraft):
            raise PlanningOutputError("Narrative writer did not return an initial draft")
        draft = writer_output

        for repair_round in range(_MAX_QUALITY_REPAIR_ROUNDS + 1):
            pacing_diagnostics = _narration_pacing_diagnostics(
                draft,
                allocated_dicts,
                correlation_id=req.correlation_id,
                cps=effective_narration_cps,
                stage="NARRATIVE_WRITING",
                repair_round=repair_round,
                correction_applied=repair_round > 0,
            )
            quality_diagnostics = _narrative_quality_diagnostics(
                draft,
                allocated_dicts,
                language=req.language,
            )
            pacing_feedback = _pacing_repair_feedback(pacing_diagnostics)
            if not pacing_feedback and not quality_diagnostics:
                break

            if repair_round >= _MAX_QUALITY_REPAIR_ROUNDS:
                hard_quality = [
                    item for item in quality_diagnostics
                    if item.get("violation") != "VERBATIM_SOURCE_COPY"
                    or item.get("terminal_after_budget")
                ]
                if hard_quality:
                    raise AllocationError(
                        str(hard_quality[0].get("message")
                            or "Narrative writer quality violations remain after bounded repairs")
                    )
                warnings = list(draft.warnings)
                if pacing_feedback:
                    warnings.append(_pacing_estimate_residual_warning(pacing_feedback))
                if quality_diagnostics:
                    warnings.append(
                        "NARRATIVE_SOURCE_COPY_RESIDUAL:repairable_short_run_accepted"
                    )
                draft = draft.model_copy(update={
                    "warnings": list(dict.fromkeys(warnings)),
                })
                break

            repair_section_ids = {
                str(item.get("section_id") or "")
                for item in [*pacing_feedback, *quality_diagnostics]
                if item.get("section_id")
            }
            quality_feedback = {
                "pacing": pacing_feedback,
                "duplicate": [
                    item for item in quality_diagnostics
                    if item.get("violation") == "DUPLICATE_NARRATION"
                    or item.get("duplicate_kind")
                ],
                "verbatim": [
                    item for item in quality_diagnostics
                    if item.get("violation") == "VERBATIM_SOURCE_COPY"
                ],
                "structure": [
                    item for item in quality_diagnostics
                    if item.get("violation") not in {
                        "DUPLICATE_NARRATION",
                        "VERBATIM_SOURCE_COPY",
                    } and not item.get("duplicate_kind")
                ],
            }
            _int_log.warning(
                "NARRATIVE_SUMMARIZE NARRATIVE_WRITING quality repair required "
                "correlation_id=%s repair_round=%d sections=%s violations=%s",
                req.correlation_id,
                repair_round + 1,
                sorted(repair_section_ids),
                sorted({
                    str(item.get("violation") or item.get("duplicate_kind") or "PACING")
                    for item in [*pacing_feedback, *quality_diagnostics]
                }),
            )
            repaired_sections, repair_results = await _call_narrative_writer_batches(
                req,
                allocated_dicts,
                language=req.language,
                intent=intent,
                constraints=list(req.constraints or []),
                content_brief=content_brief,
                multimodal_context=multimodal_context,
                beat_visuals=beat_visuals,
                stage="NARRATIVE_WRITING_QUALITY_REPAIR",
                repair_feedback=quality_feedback,
                repair_section_ids=repair_section_ids,
            )
            writer_results.extend(repair_results)
            draft = _apply_repaired_sections(draft, repaired_sections)

        plan = _build_plan(req, semantic_plan, allocation, draft, visual_candidates=visual_candidates, visual_refs_by_section=visual_refs_by_section, visual_grounding_degraded=visual_grounding_degraded)

        min_ms, max_ms = duration_window(req.target_duration_ms)
        # Final coverage is measured on the RENDER representation: the union
        # over the actual output `plan.sections[].source_refs` — exactly what
        # backend-main merges into cut ranges (`mergedSourceRefs`) and renders.
        # Bridged silences counted by the allocator are materialized into
        # those ref spans by `_assign_bridged_gaps_across_beats`, so the union
        # must equal the allocation total. A second canonical recomputation
        # from the final presentation blocks guards internal consistency
        # (lost/duplicated blocks). Exact equality is kept on purpose: any
        # nonzero delta means real content loss or an accounting divergence,
        # never rounding (all inputs are integer ms).
        ranking_by_id = {ranking.block_id: ranking for ranking in semantic_plan.block_rankings}
        section_for_index = {
            block.ordered_index: ranking_by_id[block.block_id].section_id
            for block in allocation_blocks
        }
        render_coverage_ms, canonical_ms = _final_coverages(
            plan, allocation, section_for_index
        )
        render_delta_ms = render_coverage_ms - allocation.coverage_ms
        canonical_delta_ms = canonical_ms - allocation.coverage_ms
        # Bridge attribution for diagnostics (B1): silences the allocator
        # counted vs silences present in the rendered ranges.
        selected_span_ms = sum(
            int(b.end_ms) - int(b.start_ms) for b in allocation.selected_blocks
        )
        allocator_bridged_ms = allocation.coverage_ms - selected_span_ms
        render_bridged_ms = render_coverage_ms - selected_span_ms
        if (
            render_coverage_ms != allocation.coverage_ms
            or canonical_ms != allocation.coverage_ms
            or (
                not getattr(allocation, "is_fallback", False)
                and not min_ms <= render_coverage_ms <= max_ms
            )
        ):
            _int_log.warning(
                "NARRATIVE_SUMMARIZE coverage invariant failed correlation_id=%s "
                "allocation_coverage_ms=%d render_coverage_ms=%d render_delta_ms=%d "
                "canonical_ms=%d canonical_delta_ms=%d "
                "allocator_bridged_ms=%d render_bridged_ms=%d "
                "window=[%d,%d] target_duration_ms=%d "
                "allocated_blocks=%d final_blocks=%d presentation_refs=%d beats=%d "
                "is_fallback=%s",
                req.correlation_id,
                allocation.coverage_ms,
                render_coverage_ms,
                render_delta_ms,
                canonical_ms,
                canonical_delta_ms,
                allocator_bridged_ms,
                render_bridged_ms,
                min_ms,
                max_ms,
                req.target_duration_ms,
                len(allocation.selected_blocks),
                sum(len(section.blocks) for section in allocation.sections),
                sum(len(section.source_refs) for section in plan.sections),
                len(allocation.sections),
                getattr(allocation, "is_fallback", False),
            )
            _log_coverage_bridge_detail(
                req.correlation_id,
                [
                    (int(b.start_ms), int(b.end_ms), int(b.ordered_index))
                    for section in allocation.sections
                    for b in section.blocks
                ],
                section_for_index,
            )
            raise AllocationError(
                "Final NarrativePlan coverage invariant failed: "
                f"allocation_coverage_ms={allocation.coverage_ms} "
                f"render_coverage_ms={render_coverage_ms} "
                f"render_delta_ms={render_delta_ms} "
                f"canonical_ms={canonical_ms} "
                f"canonical_delta_ms={canonical_delta_ms} "
                f"window=[{min_ms},{max_ms}] "
                f"target_duration_ms={req.target_duration_ms}"
            )

        usage = _aggregate_usage(req, planning_result, *writer_results)
        _int_log.info(
            "NARRATIVE_SUMMARIZE success correlation_id=%s plans=1 blocks=%d selected_blocks=%d "
            "coverage_ms=%d input_tokens=%d output_tokens=%d",
            req.correlation_id,
            len(blocks),
            len(allocation.selected_blocks),
            allocation.coverage_ms,
            usage.input_tokens,
            usage.output_tokens,
        )
        return NarrativeSummarizeResponse(
            correlation_id=req.correlation_id,
            status="COMPLETED",
            plans=[plan],
            usage=usage,
        )
    except PlanningOutputError as exc:
        return _failed(
            req,
            str(exc),
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
        )
    except AllocationError as exc:
        return _failed(
            req,
            str(exc),
            ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION,
        )
    except ProviderException as exc:
        detail = _force_non_retryable(exc.to_error_detail())
        _int_log.warning(
            "NARRATIVE_SUMMARIZE LLM call failed: errorCode=%s retryable=%s message=%s",
            detail.get("errorCode"),
            detail.get("retryable"),
            exc.message,
        )
        return NarrativeSummarizeResponse(
            correlation_id=req.correlation_id,
            status="FAILED",
            error=str(exc),
            error_detail=detail,
        )
