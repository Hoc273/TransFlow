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
    duration_window,
    source_coverage_target_representable,
)
from app.services.llm_gateway import chat
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
    detect_future_event_leakage,
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
        _safe_preview(user, _PROMPT_PREVIEW_CHARS),
    )
    extra_body = (
        {"thinking": {"type": "disabled"}}
        if settings.disable_thinking_for_summarize
        else None
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


def _narration_pacing_diagnostics(
    draft: NarrativeDraft,
    allocated_sections: list[dict],
    *,
    correlation_id: str | None = None,
) -> list[dict]:
    """Run source-language pacing preflight; measured TTS remains authoritative."""
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
            "pacing_status": pacing_status,
            "estimate_only": True,
            "duration_authority": "TTS",
            "predicted_duration_ms": round(
                actual_chars * 1000 / max(1, NARRATION_TARGET_CPS)
            ),
        })

    total_target_chars = sum(item["target_chars"] for item in diagnostics)
    total_actual_chars = sum(item["actual_chars"] for item in diagnostics)
    aggregate_ratio = (
        total_actual_chars / total_target_chars if total_target_chars > 0 else 1.0
    )
    for item in diagnostics:
        _int_log.info(
            "NARRATIVE_SUMMARIZE pacing preflight correlation_id=%s section_id=%s "
            "target_chars=%d actual_chars=%d ratio=%.3f pacing_status=%s "
            "deficit_chars=%d overage_chars=%d estimate_only=true duration_authority=TTS "
            "predicted_narration_duration_ms=%d",
            correlation_id,
            item["section_id"],
            item["target_chars"],
            item["actual_chars"],
            item["ratio"],
            item["pacing_status"],
            item["deficit_chars"],
            item["overage_chars"],
            item["predicted_duration_ms"],
        )
    aggregate_duration_ms = round(
        total_actual_chars * 1000 / max(1, NARRATION_TARGET_CPS)
    )
    _int_log.info(
        "NARRATIVE_SUMMARIZE pacing aggregate preflight correlation_id=%s target_chars=%d "
        "actual_chars=%d ratio=%.3f estimate_only=true duration_authority=TTS "
        "predicted_narration_duration_ms=%d",
        correlation_id,
        total_target_chars,
        total_actual_chars,
        aggregate_ratio,
        aggregate_duration_ms,
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


def _validate_recap_sentence_structure(
    draft: NarrativeDraft,
    allocation,
    language: str | None = None,
) -> None:
    """Enforce the sentence-level generative recap contract (fail-closed).

    Raises AllocationError (mapped by the caller to
    PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION, non-retryable) when the Writer
    produces an obviously invalid recap: empty output, a single huge
    paragraph for a whole section, duplicated narration, long verbatim
    dialogue copies (>15 words from source), or long Han/kana runs that must
    be summarized/translated instead of copied. The worker never dedups, so
    rejection happens here.
    """
    import re as _re

    global _CJK_COPY_RE
    if _CJK_COPY_RE is None:
        _CJK_COPY_RE = _re.compile(r"[\u4e00-\u9fff\u3040-\u30ff]{10,}")

    is_cjk_language = bool(
        language and language.lower().startswith(("zh", "ja", "ko", "cmn", "yue"))
    )

    source_text = " ".join(
        str(getattr(block, "full_text", "") or "")
        for section in getattr(allocation, "sections", [])
        for block in getattr(section, "blocks", [])
    )
    normalized_source = _re.sub(r"\s+", " ", source_text.lower()).strip()

    seen_scripts: set[str] = set()
    sentence_counts: dict[str, int] = {}
    for section in draft.sections:
        script = section.script_source_lang or ""
        if not script.strip():
            raise AllocationError(
                f"Narrative section {section.section_id} has empty script"
            )
        if not is_cjk_language and _CJK_COPY_RE.search(script):
            raise AllocationError(
                f"Narrative section {section.section_id} copies Han/kana source "
                "material instead of summarizing it"
            )
        sentences = split_sentences(script)
        if not sentences:
            raise AllocationError(
                f"Narrative section {section.section_id} has no sentence structure"
            )
        if len(sentences) == 1 and len(sentences[0]) > _RECAP_SINGLE_PARAGRAPH_CHARS:
            raise AllocationError(
                f"Narrative section {section.section_id} is a single huge paragraph "
                f"({len(sentences[0])} chars); sentence-level recap required"
            )
        normalized_script = _re.sub(r"\s+", " ", script.lower()).strip()
        if normalized_script in seen_scripts:
            raise AllocationError(
                f"Narrative section {section.section_id} duplicates another section"
            )
        seen_scripts.add(normalized_script)
        for sentence in sentences:
            key = _re.sub(r"\s+", " ", sentence.lower()).strip()
            if len(key) >= _DUP_MIN_SENTENCE_CHARS:
                sentence_counts[key] = sentence_counts.get(key, 0) + 1
                if sentence_counts[key] > _DUP_MAX_ALLOWED:
                    raise AllocationError(
                        "Duplicate narration detected across recap sections"
                    )
            words = key.split()
            if len(words) > _VERBATIM_WORD_WINDOW and normalized_source:
                if key in normalized_source:
                    raise AllocationError(
                        f"Narrative section {section.section_id} reproduces long "
                        "verbatim dialogue instead of recapping"
                    )
                for i in range(len(words) - _VERBATIM_WORD_WINDOW + 1):
                    shingle = " ".join(words[i : i + _VERBATIM_WORD_WINDOW])
                    if len(shingle) >= _DUP_MIN_SENTENCE_CHARS and shingle in normalized_source:
                        raise AllocationError(
                            f"Narrative section {section.section_id} reproduces long "
                            "verbatim dialogue instead of recapping"
                        )
    # Beat-grounding: one narration unit MUST NOT describe a future visual
    # event before its visual range begins (e.g. rabbit road-sign + wolf bee
    # attack merged into one beat). Fail closed, never rewrite.
    for section in draft.sections:
        if detect_future_event_leakage(section.script_source_lang or ""):
            raise AllocationError(
                f"Narrative section {section.section_id} describes a future visual "
                "event before its visual range begins (beat grounding violation)"
            )


def split_distant_blocks_into_sections(
    sections: list[AllocatedSection],
    max_gap_ms: int = SILENCE_BOUNDARY_MS,
    max_sections: int | None = None,
) -> list[AllocatedSection]:
    """Ensure distant or skipped canonical ranges are never merged into one section/beat.

    Enforces the Beat Grounding Invariant: A narration unit MUST NOT describe a future visual
    event before the corresponding visual range begins. If a section contains multiple blocks
    separated by a gap >= max_gap_ms (e.g. Scene A at 03:05 vs Scene B at 05:09), or skips a
    canonical block, they are split into distinct sections so narration and visual remain
    coupled. If that continuity split would exceed ``max_sections``, it raises
    ``AllocationError`` instead of merging the ranges.
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
) -> dict[str, list[tuple[int, int]]]:
    """Return continuous, duration-accurate source coverage for each beat."""
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
    return result


def _split_for_presentation(allocation, max_sections: int):
    """Split long allocated sections for pacing without changing coverage."""
    sections, refs = split_oversized_sections_at_silence(
        allocation.sections,
        max_sections=max_sections,
    )
    return allocation.model_copy(update={"sections": sections}), _presentation_source_refs(
        sections, refs
    )


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
    section_count = min(len(blocks), req.max_sections or len(blocks))
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
    try:
        allocation = allocate_blocks(
            blocks,
            target,
            plan,
            allow_fallback=True,
            max_sections=req.max_sections or 12,
        )
        # Keep the representation invariant shared with allocation: natural
        # silence below 2000ms remains one continuous source range. The source
        # refs emitted below coalesce that gap instead of silently bridging it.
        split_sections = split_distant_blocks_into_sections(
            allocation.sections,
            max_gap_ms=SILENCE_BOUNDARY_MS,
            max_sections=req.max_sections or 12,
        )
        allocation = allocation.model_copy(update={"sections": split_sections})
        allocation, visual_refs_by_section = _split_for_presentation(
            allocation, req.max_sections or 12
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
        plans=[_build_plan(req, plan, allocation, draft, validate_narrative=False, visual_candidates=visual_candidates, visual_refs_by_section=visual_refs_by_section, visual_grounding_degraded=visual_grounding_degraded)],
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
        presentation_cap = req.max_sections or 12
        if not source_coverage_target_representable(
            blocks,
            req.target_duration_ms,
            max_sections=presentation_cap,
        ):
            min_ms, max_ms = duration_window(req.target_duration_ms)
            message = (
                "source_coverage_target_not_representable: no subset of canonical "
                f"transcript blocks can cover [{min_ms}, {max_ms}]ms with "
                f"max_sections={presentation_cap} continuous source ranges"
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
            max_sections=req.max_sections,
            content_brief=content_brief,
        )
        planning_result = await _call_json_stage(
            req, "SEMANTIC_PLANNING", planning_system, planning_user
        )
        semantic_plan = parse_semantic_plan(planning_result.text, blocks, req.max_sections)

        allocation = allocate_blocks(
            blocks,
            req.target_duration_ms,
            semantic_plan,
            allow_fallback=True,
            max_sections=presentation_cap,
        )
        split_sections = split_distant_blocks_into_sections(
            allocation.sections,
            max_gap_ms=SILENCE_BOUNDARY_MS,
            max_sections=req.max_sections or 12,
        )
        allocation = allocation.model_copy(update={"sections": split_sections})
        allocation, visual_refs_by_section = _split_for_presentation(
            allocation, req.max_sections or 12
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
        # Per-section narration length target (~14 chars/s of footage) so the
        # writer roughly fills its visual range instead of leaving long
        # silent tails. Guidance only — measured TTS stays authoritative.
        for section_dict, section in zip(allocated_dicts, allocation.sections):
            presentation_refs = visual_refs_by_section.get(section.section_id)
            if presentation_refs is None:
                presentation_refs = [
                    (int(block.start_ms), int(block.end_ms))
                    for block in section.blocks
                ]
            span_ms = sum(end - start for start, end in presentation_refs)
            section_dict["target_chars"] = narration_target_chars(span_ms)
        # TASK 7 multimodal: when visual context present, inject it into writer prompt
        # Grounding (req 9) + Confidence hedging (req 10) + fight-scene narrative (req 8)
        if multimodal_context:
            writer_system, writer_user = build_narrative_multimodal_writer_prompt(
                allocated_dicts,
                language=req.language,
                intent=intent,
                constraints=list(req.constraints or []),
                content_brief=content_brief,
                multimodal_context=multimodal_context,
                beat_visuals=beat_visuals,
            )
        else:
            writer_system, writer_user = build_narrative_writer_prompt(
                allocated_dicts,
                language=req.language,
                intent=intent,
                constraints=list(req.constraints or []),
                content_brief=content_brief,
            )
        writer_result = await _call_json_stage(
            req, "NARRATIVE_WRITING", writer_system, writer_user
        )
        expected_section_ids = [section.section_id for section in allocation.sections]
        draft = parse_narrative_draft(writer_result.text, expected_section_ids)
        pacing_diagnostics = _narration_pacing_diagnostics(
            draft,
            allocated_dicts,
            correlation_id=req.correlation_id,
        )
        writer_results = [writer_result]
        if _pacing_needs_repair(pacing_diagnostics):
            pacing_feedback = _pacing_repair_feedback(pacing_diagnostics)
            repair_section_ids = [item["section_id"] for item in pacing_feedback]
            _int_log.warning(
                "NARRATIVE_SUMMARIZE NARRATIVE_WRITING pacing repair required "
                "correlation_id=%s sections=%s",
                req.correlation_id,
                [item["section_id"] for item in pacing_feedback],
            )
            if multimodal_context:
                writer_system, writer_user = build_narrative_multimodal_writer_prompt(
                    allocated_dicts,
                    language=req.language,
                    intent=intent,
                    constraints=list(req.constraints or []),
                    content_brief=content_brief,
                    multimodal_context=multimodal_context,
                    beat_visuals=beat_visuals,
                    pacing_feedback=pacing_feedback,
                )
            else:
                writer_system, writer_user = build_narrative_writer_prompt(
                    allocated_dicts,
                    language=req.language,
                    intent=intent,
                    constraints=list(req.constraints or []),
                    content_brief=content_brief,
                    pacing_feedback=pacing_feedback,
                )
            writer_repair_result = await _call_json_stage(
                req, "NARRATIVE_WRITING_REPAIR", writer_system, writer_user
            )
            writer_results.append(writer_repair_result)
            repaired_sections = parse_narrative_repair(
                writer_repair_result.text, repair_section_ids
            )
            repaired_draft = draft.model_copy(update={
                "sections": [
                    repaired_sections[section_id]
                    if section_id in repaired_sections
                    else section
                    for section_id, section in zip(expected_section_ids, draft.sections)
                ]
            })
            repaired_diagnostics = _narration_pacing_diagnostics(
                repaired_draft,
                allocated_dicts,
                correlation_id=req.correlation_id,
            )
            repaired_feedback = [
                item
                for item in _pacing_repair_feedback(repaired_diagnostics)
                if item["section_id"] in set(repair_section_ids)
            ]
            if repaired_feedback:
                residual_warning = _pacing_estimate_residual_warning(repaired_feedback)
                _int_log.warning(
                    "NARRATIVE_SUMMARIZE NARRATIVE_WRITING pacing estimate residual "
                    "accepted after one bounded repair "
                    "correlation_id=%s sections=%s estimate_only=true "
                    "duration_authority=TTS diagnostics=%s",
                    req.correlation_id,
                    [item["section_id"] for item in repaired_feedback],
                    repaired_feedback,
                    extra={
                        "pacingEstimateResidual": repaired_feedback,
                        "estimateOnly": True,
                        "durationAuthority": "TTS",
                    },
                )
                repaired_draft = repaired_draft.model_copy(update={
                    "warnings": list(dict.fromkeys([
                        *repaired_draft.warnings,
                        residual_warning,
                    ]))
                })
            draft = repaired_draft

        plan = _build_plan(req, semantic_plan, allocation, draft, visual_candidates=visual_candidates, visual_refs_by_section=visual_refs_by_section, visual_grounding_degraded=visual_grounding_degraded)

        min_ms, max_ms = duration_window(req.target_duration_ms)
        coverage_ms = sum(
            ref.end_ms - ref.start_ms
            for section in plan.sections
            for ref in section.source_refs
        )
        if coverage_ms != allocation.coverage_ms or (
            not getattr(allocation, "is_fallback", False) and not min_ms <= coverage_ms <= max_ms
        ):
            raise AllocationError("Final NarrativePlan coverage invariant failed")

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
