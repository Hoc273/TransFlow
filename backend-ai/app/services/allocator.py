from __future__ import annotations

from dataclasses import dataclass

from app.services.narrative_planning_models import (
    AllocatedSection,
    AllocationResult,
    SemanticPlan,
    TranscriptBlock,
)
from app.services.timing_boundaries import SILENCE_BOUNDARY_MS


class AllocationError(ValueError):
    pass


@dataclass(frozen=True)
class _State:
    duration_ms: int
    score: int
    runs: int
    continuity_runs: int
    indices: tuple[int, ...]

    @property
    def last_index(self) -> int:
        return self.indices[-1] if self.indices else -1


def duration_window(target_ms: int) -> tuple[int, int]:
    if target_ms <= 0:
        raise AllocationError("target_duration_ms must be positive")
    if target_ms <= 90_000:
        return max(0, target_ms - 10_000), target_ms + 10_000
    return target_ms * 9 // 10, target_ms * 11 // 10


def _state_better(left: _State, right: _State) -> bool:
    return (
        -left.score,
        left.runs,
        left.continuity_runs,
        len(left.indices),
        left.indices,
    ) < (
        -right.score,
        right.runs,
        right.continuity_runs,
        len(right.indices),
        right.indices,
    )


def _starts_new_presentation_unit(
    ordered: list[TranscriptBlock],
    previous_index: int,
    current_index: int,
    section_for_index: dict[int, str] | None = None,
) -> bool:
    if previous_index < 0:
        return True
    if current_index != previous_index + 1:
        return True
    if (
        section_for_index is not None
        and section_for_index[current_index] != section_for_index[previous_index]
    ):
        return True
    return (
        ordered[current_index].start_ms - ordered[previous_index].end_ms
        >= SILENCE_BOUNDARY_MS
    )


def _coverage_increment(
    ordered: list[TranscriptBlock],
    previous_index: int,
    current_index: int,
    section_for_index: dict[int, str] | None = None,
) -> int:
    """Return the rendered duration added by a selected block.

    Adjacent blocks owned by the same narrative section and separated only by
    a natural silence are materialized as one continuous source ref. The
    bridged silence is therefore intentionally included in duration accounting.
    """
    block = ordered[current_index]
    increment = block.duration_ms
    if previous_index < 0 or current_index != previous_index + 1:
        return increment
    if (
        section_for_index is not None
        and section_for_index[current_index] != section_for_index[previous_index]
    ):
        return increment
    gap_ms = block.start_ms - ordered[previous_index].end_ms
    if 0 < gap_ms < SILENCE_BOUNDARY_MS:
        return increment + gap_ms
    return increment


def source_coverage_target_representable(
    blocks: list[TranscriptBlock],
    target_duration_ms: int,
    max_sections: int = 12,
) -> bool:
    """Check transcript-only coverage feasibility without selecting content."""
    ordered = _validate_blocks(blocks)
    min_ms, max_ms = duration_window(target_duration_ms)
    cap = max(1, int(max_sections))
    states: set[tuple[int, int, int]] = {(0, -1, 0)}
    for position, block in enumerate(ordered):
        next_states = set(states)
        for duration_ms, last_index, presentation_units in states:
            new_duration = duration_ms + _coverage_increment(
                ordered, last_index, position
            )
            if new_duration > max_ms:
                continue
            new_units = presentation_units + int(
                _starts_new_presentation_unit(ordered, last_index, position)
            )
            if new_units > cap:
                continue
            next_states.add((new_duration, position, new_units))
        states = next_states
    return any(
        indices_duration >= min_ms
        and indices_duration <= max_ms
        and presentation_units <= cap
        and last_index >= 0
        for indices_duration, last_index, presentation_units in states
    )


def _validate_blocks(blocks: list[TranscriptBlock]) -> list[TranscriptBlock]:
    if not blocks:
        raise AllocationError("Cannot allocate an empty transcript")
    ordered = sorted(blocks, key=lambda block: block.ordered_index)
    expected_indices = list(range(1, len(ordered) + 1))
    actual_indices = [block.ordered_index for block in ordered]
    if actual_indices != expected_indices:
        raise AllocationError(
            f"Transcript block ordered_index must be contiguous from 1; got {actual_indices}"
        )
    if len({block.block_id for block in ordered}) != len(ordered):
        raise AllocationError("Transcript block_id values must be unique")
    previous_end = -1
    for block in ordered:
        if block.start_ms < 0 or block.end_ms <= block.start_ms:
            raise AllocationError(f"Invalid block range for {block.block_id}")
        if block.duration_ms != block.end_ms - block.start_ms:
            raise AllocationError(f"duration_ms mismatch for {block.block_id}")
        if block.start_ms < previous_end:
            raise AllocationError("Canonical transcript blocks must not overlap")
        previous_end = block.end_ms
    return ordered


def allocate_blocks(
    blocks: list[TranscriptBlock],
    target_duration_ms: int,
    semantic_plan: SemanticPlan,
    *,
    allow_fallback: bool = False,
    max_sections: int | None = None,
) -> AllocationResult:
    ordered = _validate_blocks(blocks)
    presentation_cap = None if max_sections is None else max(1, int(max_sections))
    min_ms, max_ms = duration_window(target_duration_ms)
    available_ms = sum(block.duration_ms for block in ordered)
    for previous, current in zip(ordered, ordered[1:]):
        gap_ms = current.start_ms - previous.end_ms
        if 0 < gap_ms < SILENCE_BOUNDARY_MS:
            available_ms += gap_ms
    effective_max = min(max_ms, available_ms)
    if min_ms > effective_max:
        if not allow_fallback:
            raise AllocationError(
                f"No whole-block allocation can satisfy duration window [{min_ms}, {max_ms}] "
                f"with {available_ms}ms available"
            )
        effective_max = available_ms

    ranking_by_id = {ranking.block_id: ranking for ranking in semantic_plan.block_rankings}
    if set(ranking_by_id) != {block.block_id for block in ordered}:
        raise AllocationError("Semantic rankings must cover every canonical block")

    section_by_id = {section.section_id: section for section in semantic_plan.sections}
    if not section_by_id:
        raise AllocationError("Semantic plan must contain sections")

    # Beat hints describe narrative roles. Only the planner's explicit
    # essential flag creates a section-preservation requirement.
    essential_section_ids = {
        section.section_id
        for section in semantic_plan.sections
        if section.essential
    }
    section_for_index = {
        index: ranking_by_id[block.block_id].section_id
        for index, block in enumerate(ordered)
    }
    missing_essential_sections = essential_section_ids - set(section_for_index.values())
    if missing_essential_sections:
        raise AllocationError(
            "Explicitly essential sections have no ranked blocks: "
            + ", ".join(sorted(missing_essential_sections))
        )
    preferred_block_ids = {
        block_id
        for section in semantic_plan.sections
        for block_id in section.preferred_blocks
    }

    def _state_key(state: _State) -> tuple:
        selected_essential_sections = tuple(sorted(
            {
                section_for_index[index]
                for index in state.indices
                if section_for_index[index] in essential_section_ids
            }
        ))
        selected_preferred_count = sum(
            1
            for index in state.indices
            if ordered[index].block_id in preferred_block_ids
        )
        return (
            state.duration_ms,
            state.last_index,
            state.runs,
            selected_essential_sections,
            selected_preferred_count,
        )

    states: dict[tuple, _State] = {(0, -1, 0, (), 0): _State(0, 0, 0, 0, ())}
    for position, block in enumerate(ordered):
        ranking = ranking_by_id[block.block_id]
        if ranking.section_id not in section_by_id:
            raise AllocationError(
                f"Block {block.block_id} references unknown section {ranking.section_id}"
            )
        block_score = round(ranking.importance * 1_000_000)
        next_states = dict(states)
        for state in states.values():
            new_duration = state.duration_ms + _coverage_increment(
                ordered,
                state.last_index,
                position,
                section_for_index,
            )
            if new_duration > effective_max:
                continue
            index_continuous = bool(state.indices and state.last_index + 1 == position)
            candidate = _State(
                duration_ms=new_duration,
                score=state.score + block_score,
                runs=state.runs
                + int(
                    _starts_new_presentation_unit(
                        ordered,
                        state.last_index,
                        position,
                        section_for_index,
                    )
                ),
                continuity_runs=state.continuity_runs + int(not index_continuous),
                indices=state.indices + (position,),
            )
            if presentation_cap is not None and candidate.runs > presentation_cap:
                continue
            key = _state_key(candidate)
            existing = next_states.get(key)
            if existing is None or _state_better(candidate, existing):
                next_states[key] = candidate
        states = next_states

    min_essential_duration = 0
    for section_id in essential_section_ids:
        section_durations = [
            block.duration_ms
            for block in ordered
            if section_for_index[block.ordered_index - 1] == section_id
        ]
        min_essential_duration += min(section_durations)

    if min_essential_duration > effective_max:
        raise AllocationError(
            "Explicitly essential sections cannot fit the allocation budget: "
            f"minimum={min_essential_duration}ms max={effective_max}ms"
        )

    def _satisfies_story_arc(state: _State) -> bool:
        selected_sections = {
            section_for_index[index]
            for index in state.indices
        }
        return essential_section_ids.issubset(selected_sections)

    feasible = [
        state
        for state in states.values()
        if state.indices
        and min_ms <= state.duration_ms <= effective_max
        and _satisfies_story_arc(state)
    ]

    is_fallback = False
    if not feasible:
        if not allow_fallback:
            cap_detail = (
                f" with max_sections={presentation_cap}"
                if presentation_cap is not None
                else ""
            )
            raise AllocationError(
                f"No whole-block allocation satisfies duration window [{min_ms}, {max_ms}]"
                f"{cap_detail}"
            )
        non_empty = [
            state
            for state in states.values()
            if state.indices and _satisfies_story_arc(state)
        ]
        if not non_empty:
            raise AllocationError(
                "No whole-block allocation can preserve all explicitly essential sections "
                f"within duration window [{min_ms}, {max_ms}]"
            )
        best = min(
            non_empty,
            key=lambda state: (
                abs(state.duration_ms - target_duration_ms),
                -sum(
                    1
                    for index in state.indices
                    if ordered[index].block_id in preferred_block_ids
                ),
                -state.score,
                state.runs,
                state.continuity_runs,
                len(state.indices),
                state.indices,
            ),
        )
        is_fallback = True
    else:
        best = min(
            feasible,
            key=lambda state: (
                abs(state.duration_ms - target_duration_ms),
                -sum(
                    1
                    for index in state.indices
                    if ordered[index].block_id in preferred_block_ids
                ),
                -state.score,
                state.runs,
                state.continuity_runs,
                len(state.indices),
                state.indices,
            ),
        )
    selected = [ordered[index] for index in best.indices]

    selected_by_section: dict[str, list[TranscriptBlock]] = {}
    for block in selected:
        section_id = ranking_by_id[block.block_id].section_id
        selected_by_section.setdefault(section_id, []).append(block)

    allocated_sections: list[AllocatedSection] = []
    for semantic_section in semantic_plan.sections:
        section_blocks = selected_by_section.get(semantic_section.section_id)
        if not section_blocks:
            continue
        allocated_sections.append(
            AllocatedSection(
                section_id=semantic_section.section_id,
                title=semantic_section.title,
                goal=semantic_section.goal,
                beat_hint=semantic_section.beat_hint,
                blocks=section_blocks,
            )
        )
    if not allocated_sections:
        raise AllocationError("Allocation produced no viable narrative sections")

    coverage_ms = best.duration_ms
    if not is_fallback and not min_ms <= coverage_ms <= max_ms:
        raise AllocationError("Allocator invariant failed: final coverage is outside tolerance")
    for previous, current in zip(selected, selected[1:]):
        if current.start_ms < previous.end_ms:
            raise AllocationError("Allocator invariant failed: selected blocks overlap")

    return AllocationResult(
        sections=allocated_sections,
        selected_blocks=selected,
        coverage_ms=coverage_ms,
        min_duration_ms=min_ms,
        max_duration_ms=max_ms,
        is_fallback=is_fallback,
    )
