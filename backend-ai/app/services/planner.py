from __future__ import annotations

from pydantic import ValidationError

from app.api.structured import parse_json_object
from app.services.narrative_planning_models import (
    NarrativeDraft,
    SemanticPlan,
    TranscriptBlock,
    WrittenSection,
)


class PlanningOutputError(ValueError):
    pass


def _normalize_written_section_compat(raw_section: object) -> object:
    """Remove only DeepSeek's semantically-empty nullable helper field."""
    if not isinstance(raw_section, dict):
        return raw_section
    normalized = dict(raw_section)
    if normalized.get("beat_type_note") is None:
        normalized.pop("beat_type_note", None)
    return normalized


def parse_semantic_plan(
    raw_text: str,
    blocks: list[TranscriptBlock],
    max_sections: int | None,
) -> SemanticPlan:
    try:
        plan = SemanticPlan.model_validate(parse_json_object(raw_text))
    except (ValueError, ValidationError) as exc:
        raise PlanningOutputError(f"Malformed semantic planning output: {exc}") from exc

    if not plan.sections:
        raise PlanningOutputError("Semantic planning output must contain at least one section")
    if max_sections is not None and len(plan.sections) > max_sections:
        raise PlanningOutputError(
            f"Semantic planning output has {len(plan.sections)} sections; max_sections is {max_sections}"
        )

    block_ids = [block.block_id for block in blocks]
    block_id_set = set(block_ids)
    section_ids = [section.section_id for section in plan.sections]
    section_id_set = set(section_ids)
    if len(section_id_set) != len(section_ids):
        raise PlanningOutputError("Semantic section_id values must be unique")

    ranking_ids = [ranking.block_id for ranking in plan.block_rankings]
    if len(set(ranking_ids)) != len(ranking_ids):
        raise PlanningOutputError("Each block_id must have exactly one semantic ranking")
    if set(ranking_ids) != block_id_set:
        missing = sorted(block_id_set - set(ranking_ids))
        unknown = sorted(set(ranking_ids) - block_id_set)
        raise PlanningOutputError(
            f"Semantic rankings must cover every block exactly once; missing={missing}, unknown={unknown}"
        )

    owner_by_block: dict[str, str] = {}
    for ranking in plan.block_rankings:
        if ranking.section_id not in section_id_set:
            raise PlanningOutputError(
                f"Ranking for {ranking.block_id} references unknown section_id {ranking.section_id}"
            )
        owner_by_block[ranking.block_id] = ranking.section_id

    for section in plan.sections:
        if not section.section_id.strip() or not section.goal.strip():
            raise PlanningOutputError("section_id and goal must be non-blank")
        if len(set(section.preferred_blocks)) != len(section.preferred_blocks):
            raise PlanningOutputError(
                f"preferred_blocks contains duplicates for section {section.section_id}"
            )
        for block_id in section.preferred_blocks:
            if block_id not in block_id_set:
                raise PlanningOutputError(f"Unknown preferred block_id {block_id}")
            if owner_by_block[block_id] != section.section_id:
                raise PlanningOutputError(
                    f"Preferred block {block_id} is owned by {owner_by_block[block_id]}, "
                    f"not {section.section_id}"
                )

    section_order = {section_id: index for index, section_id in enumerate(section_ids)}
    previous_owner_index = -1
    rankings_by_id = {ranking.block_id: ranking for ranking in plan.block_rankings}
    for block_id in block_ids:
        owner_index = section_order[rankings_by_id[block_id].section_id]
        if owner_index < previous_owner_index:
            raise PlanningOutputError("Semantic section ownership must preserve transcript order")
        previous_owner_index = owner_index

    return plan


def parse_narrative_draft(
    raw_text: str,
    expected_section_ids: list[str],
) -> NarrativeDraft:
    try:
        payload = parse_json_object(raw_text)
        sections = payload.get("sections")
        if isinstance(sections, list):
            payload = {
                **payload,
                "sections": [
                    _normalize_written_section_compat(section)
                    for section in sections
                ],
            }
        draft = NarrativeDraft.model_validate(payload)
    except (ValueError, ValidationError) as exc:
        raise PlanningOutputError(f"Malformed narrative writing output: {exc}") from exc

    actual_ids = [section.section_id for section in draft.sections]
    if len(set(actual_ids)) != len(actual_ids):
        raise PlanningOutputError("Narrative writer section_id values must be unique")
    if actual_ids != expected_section_ids:
        raise PlanningOutputError(
            f"Narrative writer must return allocated sections in order; "
            f"expected={expected_section_ids}, actual={actual_ids}"
        )
    for section in draft.sections:
        if not section.script_source_lang.strip():
            raise PlanningOutputError(
                f"Narrative writer returned blank script for section {section.section_id}"
            )
    return draft


def parse_narrative_repair(
    raw_text: str,
    repair_section_ids: list[str],
) -> dict[str, WrittenSection]:
    """Parse only the sections requested by a bounded narration repair."""
    expected_ids = list(dict.fromkeys(repair_section_ids))
    expected_id_set = set(expected_ids)
    try:
        payload = parse_json_object(raw_text)
        raw_sections = payload.get("sections")
        if not isinstance(raw_sections, list):
            raise ValueError("Narrative repair output must contain a sections array")

        repaired: dict[str, WrittenSection] = {}
        actual_ids: list[str] = []
        for raw_section in raw_sections:
            if not isinstance(raw_section, dict):
                continue
            section_id = raw_section.get("section_id")
            if section_id not in expected_id_set:
                continue
            if section_id in repaired:
                raise ValueError(
                    f"Narrative repair returned duplicate section_id {section_id}"
                )
            section = WrittenSection.model_validate(
                _normalize_written_section_compat(raw_section)
            )
            if not section.script_source_lang.strip():
                raise ValueError(
                    f"Narrative repair returned blank script for section {section_id}"
                )
            repaired[section_id] = section
            actual_ids.append(section_id)

        if actual_ids != expected_ids:
            raise ValueError(
                "Narrative repair must return every requested section; "
                f"expected={expected_ids}, actual={actual_ids}"
            )
        return repaired
    except (ValueError, ValidationError) as exc:
        raise PlanningOutputError(f"Malformed narrative writing repair output: {exc}") from exc
