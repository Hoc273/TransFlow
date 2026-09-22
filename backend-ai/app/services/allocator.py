from __future__ import annotations

from dataclasses import dataclass

from app.core.logging_config import get_internal_logger
from app.services.narrative_planning_models import (
    AllocatedSection,
    AllocationResult,
    SemanticPlan,
    TranscriptBlock,
)
from app.services.timing_boundaries import SILENCE_BOUNDARY_MS


class AllocationError(ValueError):
    pass


MAX_FRONTIER_STATES = 8_192
MAX_REPRESENTABILITY_STATES = 4_096

_int_log = get_internal_logger("allocator")


@dataclass(frozen=True)
class _State:
    duration_ms: int
    score: int
    runs: int
    continuity_runs: int
    essential_mask: int
    preferred_count: int
    indices: tuple[int, ...]
    timeline_bucket_mask: int
    overall_span_ms: int
    largest_uncovered_gap_ms: int

    @property
    def last_index(self) -> int:
        return self.indices[-1] if self.indices else -1


def duration_window(target_ms: int) -> tuple[int, int]:
    if target_ms <= 0:
        raise AllocationError("target_duration_ms must be positive")
    if target_ms <= 90_000:
        return max(0, target_ms - 10_000), target_ms + 10_000
    return target_ms * 9 // 10, target_ms * 11 // 10


def is_bridged_gap(gap_ms: int, bridge_gap_ms: int = SILENCE_BOUNDARY_MS) -> bool:
    """Shared gap rule for every source-coverage calculation.

    Only a strictly positive silence strictly below the bridge threshold is
    rendered as continuous source footage. Touching/overlapping ranges
    (``gap_ms <= 0``) contribute nothing extra; gaps at or above the threshold
    stay separate presentation ranges. The strict ``<`` (never ``<=``) is
    load-bearing: every split condition in this pipeline treats
    ``gap >= SILENCE_BOUNDARY_MS`` as a presentation discontinuity (block
    grouping, continuity splits, representability check).
    """
    return 0 < int(gap_ms) < int(bridge_gap_ms)


def compute_effective_coverage_ms(
    intervals,
    bridge_gap_ms: int = SILENCE_BOUNDARY_MS,
    section_for_index: dict[int, str] | None = None,
) -> int:
    """Canonical source-of-truth for source coverage (single implementation).

    ``intervals`` is an iterable of ``(start_ms, end_ms)`` or
    ``(start_ms, end_ms, order_key)`` tuples, where ``order_key`` is the
    canonical transcript order (``TranscriptBlock.ordered_index``; sub-block
    tiles produced by presentation splits share their parent's key).

    Semantics (exactly the allocation accounting, order-independent
    restatement):
    - normalize to ints, drop degenerate ranges (``end <= start``);
    - sort by ``(order_key, start, end)`` and drop exact duplicates so
      repeated refs are never double-counted;
    - merge touching/overlapping ranges (``gap <= 0``) into one run;
    - sum run durations, then bridge an adjacent positive gap **iff**
      ``is_bridged_gap`` holds **and** (in keyed mode) the flanking runs carry
      consecutive order keys **and** (when ``section_for_index`` is given)
      both keys map to the same narrative section — the exact
      :func:`_coverage_increment` rule, so crossing a ranking-section
      boundary stays a hard cut that is never bridged. Unkeyed mode
      (no order keys) bridges every sub-threshold gap; it exists for geometric
      union math only and must not back the final coverage invariant.
    - mixed keyed/unkeyed input, or a section map without keys, raises
      instead of guessing.
    """
    keyed: list[tuple[int, int, int | None]] = []
    for item in intervals:
        if len(item) == 2:
            start_ms, end_ms = item
            order_key = None
        elif len(item) == 3:
            start_ms, end_ms, order_key = item
            order_key = None if order_key is None else int(order_key)
        else:
            raise AllocationError(
                "Coverage intervals must be (start_ms, end_ms) or "
                f"(start_ms, end_ms, order_key); got {item!r}"
            )
        start_ms, end_ms = int(start_ms), int(end_ms)
        if end_ms <= start_ms:
            continue
        keyed.append((start_ms, end_ms, order_key))
    if not keyed:
        return 0
    keyed_mode = keyed[0][2] is not None
    if any((k is None) != (not keyed_mode) for _, _, k in keyed):
        raise AllocationError(
            "Coverage intervals must not mix keyed and unkeyed entries"
        )
    if section_for_index is not None and not keyed_mode:
        raise AllocationError(
            "Coverage section map requires keyed intervals"
        )
    keyed.sort(key=lambda t: (t[2] if t[2] is not None else 0, t[0], t[1]))
    deduped = list(dict.fromkeys(keyed))

    def _same_section(prev_key: int | None, cur_key: int | None) -> bool:
        if section_for_index is None:
            return True
        # Fail closed: keys absent from the map never bridge.
        return prev_key in section_for_index and (
            section_for_index.get(prev_key) == section_for_index.get(cur_key)
        )

    total = 0
    run_start, run_end, run_last_key = deduped[0]
    for start_ms, end_ms, order_key in deduped[1:]:
        gap_ms = start_ms - run_end
        if gap_ms <= 0:
            # Touching/overlapping: fold into the current run, never
            # double-count. Canonical data never overlaps; this is
            # defensive for evidence refs.
            run_end = max(run_end, end_ms)
            run_last_key = order_key
            continue
        total += run_end - run_start
        if (
            is_bridged_gap(gap_ms, bridge_gap_ms)
            and (not keyed_mode or order_key == run_last_key + 1)
            and _same_section(run_last_key, order_key)
        ):
            total += gap_ms
        run_start, run_end, run_last_key = start_ms, end_ms, order_key
    total += run_end - run_start
    return total


def _state_better(left: _State, right: _State) -> bool:
    return (
        -left.score,
        left.runs,
        left.continuity_runs,
        -left.overall_span_ms,
        left.largest_uncovered_gap_ms,
        len(left.indices),
        left.indices,
    ) < (
        -right.score,
        right.runs,
        right.continuity_runs,
        -right.overall_span_ms,
        right.largest_uncovered_gap_ms,
        len(right.indices),
        right.indices,
    )


def timeline_bucket_count(
    source_span_ms: int,
    target_duration_ms: int,
    presentation_cap: int | None = None,
) -> int:
    """Return a small deterministic bucket count for source chronology preference."""
    source_span_ms = max(0, int(source_span_ms))
    target_duration_ms = max(1, int(target_duration_ms))
    if source_span_ms <= 0:
        bucket_count = 4
    else:
        bucket_count = min(8, max(4, round(source_span_ms / target_duration_ms * 4)))
    if presentation_cap is not None:
        bucket_count = min(bucket_count, max(1, int(presentation_cap)))
    return bucket_count


def _timeline_bucket_mask(
    start_ms: int,
    end_ms: int,
    source_start_ms: int,
    source_span_ms: int,
    bucket_count: int,
) -> int:
    if end_ms <= start_ms or source_span_ms <= 0:
        return 0
    clipped_start_ms = max(int(start_ms), source_start_ms)
    clipped_end_ms = min(int(end_ms), source_start_ms + source_span_ms)
    if clipped_end_ms <= clipped_start_ms:
        return 0
    first_bucket = min(
        bucket_count - 1,
        max(0, (clipped_start_ms - source_start_ms) * bucket_count // source_span_ms),
    )
    last_bucket = min(
        bucket_count - 1,
        max(
            0,
            (clipped_end_ms - 1 - source_start_ms) * bucket_count // source_span_ms,
        ),
    )
    return ((1 << (last_bucket - first_bucket + 1)) - 1) << first_bucket


def _largest_uncovered_gap_for_indices(
    ordered: list[TranscriptBlock], indices: tuple[int, ...]
) -> int:
    if not indices:
        return 0
    gaps = [
        max(0, ordered[indices[0]].start_ms - ordered[0].start_ms),
        max(0, ordered[-1].end_ms - ordered[indices[-1]].end_ms),
    ]
    gaps.extend(
        max(0, ordered[current].start_ms - ordered[previous].end_ms)
        for previous, current in zip(indices, indices[1:])
    )
    return max(gaps, default=0)


def chronology_coverage_metrics(
    blocks: list[TranscriptBlock],
    selected_blocks: list[TranscriptBlock],
    target_duration_ms: int,
    section_for_index: dict[int, str] | None = None,
    presentation_cap: int | None = None,
) -> dict[str, int | bool | list[int] | None]:
    """Summarize selected source chronology for diagnostics and tie-breaking."""
    if not blocks:
        empty_bucket_count = timeline_bucket_count(
            0, target_duration_ms, presentation_cap=presentation_cap
        )
        return {
            "source_span_ms": 0,
            "source_start_ms": 0,
            "source_end_ms": 0,
            "timeline_bucket_count": empty_bucket_count,
            "timeline_buckets_covered": [],
            "overall_temporal_span_ms": 0,
            "largest_uncovered_gap_ms": 0,
            "selected_run_count": 0,
            "selected_first_start_ms": None,
            "selected_last_end_ms": None,
            "leading_uncovered_ms": 0,
            "trailing_uncovered_ms": 0,
            "first_bucket_covered": False,
            "last_bucket_covered": False,
        }
    ordered = sorted(blocks, key=lambda block: block.ordered_index)
    source_start_ms = ordered[0].start_ms
    source_end_ms = ordered[-1].end_ms
    source_span_ms = max(0, source_end_ms - source_start_ms)
    bucket_count = timeline_bucket_count(
        source_span_ms, target_duration_ms, presentation_cap=presentation_cap
    )
    selected = sorted(selected_blocks, key=lambda block: block.ordered_index)
    mask = 0
    largest_gap_ms = 0
    run_count = 0
    first_selected = selected[0] if selected else None
    selected_first_start_ms = first_selected.start_ms if first_selected else None
    selected_last_end_ms = selected[-1].end_ms if selected else None
    leading_uncovered_ms = (
        max(0, selected_first_start_ms - source_start_ms)
        if selected_first_start_ms is not None
        else 0
    )
    trailing_uncovered_ms = (
        max(0, source_end_ms - selected_last_end_ms)
        if selected_last_end_ms is not None
        else 0
    )
    if selected:
        largest_gap_ms = max(
            largest_gap_ms,
            leading_uncovered_ms,
            trailing_uncovered_ms,
        )
    previous = None
    for block in selected:
        mask |= _timeline_bucket_mask(
            block.start_ms,
            block.end_ms,
            source_start_ms,
            source_span_ms,
            bucket_count,
        )
        if previous is None:
            run_count = 1
        else:
            gap_ms = block.start_ms - previous.end_ms
            same_section = (
                section_for_index is None
                or section_for_index.get(block.ordered_index)
                == section_for_index.get(previous.ordered_index)
            )
            if (
                block.ordered_index != previous.ordered_index + 1
                or not same_section
                or gap_ms >= SILENCE_BOUNDARY_MS
            ):
                run_count += 1
            largest_gap_ms = max(largest_gap_ms, max(0, gap_ms))
        previous = block
    overall_span_ms = (
        max(0, selected[-1].end_ms - first_selected.start_ms)
        if first_selected is not None
        else 0
    )
    return {
        "source_span_ms": source_span_ms,
        "source_start_ms": source_start_ms,
        "source_end_ms": source_end_ms,
        "timeline_bucket_count": bucket_count,
        "timeline_buckets_covered": [
            index for index in range(bucket_count) if mask & (1 << index)
        ],
        "overall_temporal_span_ms": overall_span_ms,
        "largest_uncovered_gap_ms": largest_gap_ms,
        "selected_run_count": run_count,
        "selected_first_start_ms": selected_first_start_ms,
        "selected_last_end_ms": selected_last_end_ms,
        "leading_uncovered_ms": leading_uncovered_ms,
        "trailing_uncovered_ms": trailing_uncovered_ms,
        "first_bucket_covered": bool(mask & 1),
        "last_bucket_covered": bool(mask & (1 << (bucket_count - 1))),
    }


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
    if is_bridged_gap(gap_ms):
        return increment + gap_ms
    return increment


def source_coverage_target_representable(
    blocks: list[TranscriptBlock],
    target_duration_ms: int,
    max_sections: int | None = None,
) -> bool:
    """Check transcript-only coverage feasibility without selecting content.

    ``max_sections`` remains in the signature for older callers, but
    presentation-unit count is deliberately not part of feasibility. A source
    subset is representable when its effective coverage falls inside the
    duration window, regardless of how many later boundary-driven beats it
    needs.
    """
    ordered = _validate_blocks(blocks)
    min_ms, max_ms = duration_window(target_duration_ms)
    frontier_limit = max(1, int(MAX_REPRESENTABILITY_STATES))
    states: set[tuple[int, int, int]] = {(0, -1, 0)}
    frontier_high_water_mark = len(states)
    search_truncated = False
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
            candidate = (new_duration, position, new_units)
            if min_ms <= new_duration <= max_ms:
                return True
            next_states.add(candidate)
        if len(next_states) > frontier_limit:
            search_truncated = True
            ranked_states = sorted(
                next_states,
                key=lambda state: (
                    abs(state[0] - target_duration_ms),
                    state[2],
                    -state[0],
                    state[1],
                ),
            )
            states = set(ranked_states[:frontier_limit])
            frontier_high_water_mark = max(frontier_high_water_mark, len(states))
            _int_log.warning(
                "NARRATIVE_ALLOCATOR representability frontier pruned "
                "frontier_before=%d frontier_after=%d position=%d "
                "high_water_mark=%d "
                "search_truncated=true",
                len(next_states),
                len(states),
                position + 1,
                frontier_high_water_mark,
            )
        else:
            states = next_states
            frontier_high_water_mark = max(frontier_high_water_mark, len(states))
        if not states:
            break
    if search_truncated:
        # This is only a preflight optimization. A truncated search is not a
        # proof that no exact whole-block allocation exists.
        return True
    return any(
        indices_duration >= min_ms
        and indices_duration <= max_ms
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
    # Compatibility-only soft preference for older callers. Presentation beat
    # count is not a feasibility constraint and is finalized after allocation.
    presentation_cap = (
        max(1, int(max_sections)) if max_sections is not None else None
    )
    min_ms, max_ms = duration_window(target_duration_ms)
    # Upper bound of renderable source: every canonical block plus every
    # bridgeable inter-block silence. `ordered` is consecutive 1..N by
    # construction (_validate_blocks), so the canonical helper applies the
    # exact same gap rule as the loop it replaces.
    available_ms = compute_effective_coverage_ms(
        [(block.start_ms, block.end_ms, block.ordered_index) for block in ordered]
    )
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

    for block in ordered:
        ranking = ranking_by_id[block.block_id]
        if ranking.section_id not in section_by_id:
            raise AllocationError(
                f"Block {block.block_id} references unknown section {ranking.section_id}"
            )

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

    essential_section_bits = {
        section_id: 1 << bit
        for bit, section_id in enumerate(
            section.section_id
            for section in semantic_plan.sections
            if section.essential
        )
    }
    all_essential_mask = (1 << len(essential_section_bits)) - 1
    essential_min_duration_by_id: dict[str, int] = {}
    essential_end_position_by_id: dict[str, int] = {}
    for position, block in enumerate(ordered):
        section_id = section_for_index[position]
        if section_id not in essential_section_bits:
            continue
        essential_min_duration_by_id[section_id] = min(
            block.duration_ms,
            essential_min_duration_by_id.get(section_id, block.duration_ms),
        )
        essential_end_position_by_id[section_id] = position

    min_essential_duration = sum(essential_min_duration_by_id.values())
    if min_essential_duration > effective_max:
        raise AllocationError(
            "Explicitly essential sections cannot fit the allocation budget: "
            f"minimum={min_essential_duration}ms max={effective_max}ms"
        )
    essential_bit_by_index = [
        essential_section_bits.get(section_for_index[index], 0)
        for index in range(len(ordered))
    ]
    preferred_by_index = [
        block.block_id in preferred_block_ids for block in ordered
    ]
    essential_end_mask_by_position: dict[int, int] = {}
    for section_id, position in essential_end_position_by_id.items():
        essential_end_mask_by_position[position] = (
            essential_end_mask_by_position.get(position, 0)
            | essential_section_bits[section_id]
        )
    expired_essential_mask_by_position: list[int] = []
    expired_mask = 0
    for position in range(len(ordered)):
        expired_mask |= essential_end_mask_by_position.get(position, 0)
        expired_essential_mask_by_position.append(expired_mask)

    essential_bit_durations = [
        (bit, essential_min_duration_by_id[section_id])
        for section_id, bit in essential_section_bits.items()
    ]

    source_span_ms = max(0, ordered[-1].end_ms - ordered[0].start_ms)
    bucket_count = timeline_bucket_count(source_span_ms, target_duration_ms)
    block_bucket_masks = [
        _timeline_bucket_mask(
            block.start_ms,
            block.end_ms,
            ordered[0].start_ms,
            source_span_ms,
            bucket_count,
        )
        for block in ordered
    ]
    first_bucket_bit = 1
    last_bucket_bit = 1 << (bucket_count - 1)

    def _select_best(candidates: list[_State]) -> _State:
        """Choose feasible chronology winners, then duration, then semantics."""
        if bucket_count > 1:
            endpoint_mask = first_bucket_bit | last_bucket_bit
            edge_candidates = [
                state
                for state in candidates
                if (
                    state.timeline_bucket_mask & endpoint_mask
                ) == endpoint_mask
            ]
            if not edge_candidates:
                edge_candidates = [
                    state
                    for state in candidates
                    if state.timeline_bucket_mask & last_bucket_bit
                ]
            chronology_candidates = edge_candidates or candidates
        else:
            chronology_candidates = candidates

        closest_distance = min(
            abs(state.duration_ms - target_duration_ms)
            for state in chronology_candidates
        )
        duration_candidates = [
            state
            for state in chronology_candidates
            if abs(state.duration_ms - target_duration_ms) == closest_distance
        ]

        max_bucket_count = max(
            state.timeline_bucket_mask.bit_count() for state in duration_candidates
        )
        bucket_candidates = [
            state
            for state in duration_candidates
            if state.timeline_bucket_mask.bit_count() == max_bucket_count
        ]
        smallest_gap = min(
            state.largest_uncovered_gap_ms for state in bucket_candidates
        )
        gap_candidates = [
            state
            for state in bucket_candidates
            if state.largest_uncovered_gap_ms == smallest_gap
        ]
        largest_span = max(state.overall_span_ms for state in gap_candidates)
        span_candidates = [
            state
            for state in gap_candidates
            if state.overall_span_ms == largest_span
        ]
        preferred_count = max(
            state.preferred_count for state in span_candidates
        )
        preferred_candidates = [
            state
            for state in span_candidates
            if state.preferred_count == preferred_count
        ]
        if presentation_cap is not None:
            soft_cap_candidates = [
                state
                for state in preferred_candidates
                if state.runs <= presentation_cap
            ]
            if soft_cap_candidates:
                preferred_candidates = soft_cap_candidates
        max_score = max(state.score for state in preferred_candidates)
        semantic_candidates = [
            state
            for state in preferred_candidates
            if state.score == max_score
        ]
        return min(
            semantic_candidates,
            key=lambda state: (
                state.runs,
                state.continuity_runs,
                len(state.indices),
                state.indices,
            ),
        )

    def _state_key(state: _State) -> tuple:
        return (
            state.duration_ms,
            state.last_index,
            state.runs,
            state.essential_mask,
            state.preferred_count,
            state.timeline_bucket_mask,
        )

    def _remaining_essential_requirements(state: _State) -> tuple[int, int]:
        remaining_mask = all_essential_mask & ~state.essential_mask
        remaining_count = remaining_mask.bit_count()
        remaining_duration = sum(
            duration_ms
            for bit, duration_ms in essential_bit_durations
            if remaining_mask & bit
        )
        return remaining_count, remaining_duration

    def _state_can_complete(state: _State, position: int) -> bool:
        if position >= 0:
            expired_mask = expired_essential_mask_by_position[position]
            # parse_semantic_plan guarantees monotonic section ownership, so
            # an unrepresented section cannot be recovered after its boundary.
            if (state.essential_mask & expired_mask) != expired_mask:
                return False
        remaining_count, remaining_duration = _remaining_essential_requirements(state)
        if state.duration_ms + remaining_duration > effective_max:
            return False
        return True

    def _frontier_rank(state: _State) -> tuple:
        remaining_count, remaining_duration = _remaining_essential_requirements(state)
        return (
            # Keep states that preserve the most future essential choices.
            remaining_count,
            remaining_duration,
            -state.essential_mask.bit_count(),
            # Preserve feasible timeline edges before semantic tie-breakers so
            # bounded pruning cannot discard the story's late resolution.
            -int(bool(state.timeline_bucket_mask & last_bucket_bit)),
            -int(bool(state.timeline_bucket_mask & first_bucket_bit)),
            -state.timeline_bucket_mask.bit_count(),
            abs(state.duration_ms - target_duration_ms),
            state.largest_uncovered_gap_ms,
            -state.overall_span_ms,
            -state.preferred_count,
            -state.score,
            state.runs,
            state.continuity_runs,
            len(state.indices),
            state.indices,
        )

    initial_state = _State(
        duration_ms=0,
        score=0,
        runs=0,
        continuity_runs=0,
        essential_mask=0,
        preferred_count=0,
        indices=(),
        timeline_bucket_mask=0,
        overall_span_ms=0,
        largest_uncovered_gap_ms=0,
    )
    states: dict[tuple, _State] = {_state_key(initial_state): initial_state}
    frontier_limit = max(1, int(MAX_FRONTIER_STATES))
    frontier_high_water_mark = len(states)
    for position, block in enumerate(ordered):
        ranking = ranking_by_id[block.block_id]
        block_score = round(ranking.importance * 1_000_000)
        frontier_before = len(states)
        # The live frontier is capped; each state contributes at most one
        # include candidate, so this temporary map is bounded by about 2K.
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
            candidate_indices = state.indices + (position,)
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
                essential_mask=state.essential_mask | essential_bit_by_index[position],
                preferred_count=state.preferred_count + int(preferred_by_index[position]),
                indices=candidate_indices,
                timeline_bucket_mask=state.timeline_bucket_mask | block_bucket_masks[position],
                overall_span_ms=(
                    block.end_ms - ordered[candidate_indices[0]].start_ms
                ),
                largest_uncovered_gap_ms=_largest_uncovered_gap_for_indices(
                    ordered, candidate_indices
                ),
            )
            key = _state_key(candidate)
            existing = next_states.get(key)
            if existing is None or _state_better(candidate, existing):
                next_states[key] = candidate
        live_states = {
            key: state
            for key, state in next_states.items()
            if _state_can_complete(state, position)
        }
        if len(live_states) > frontier_limit:
            next_frontier_before_prune = len(live_states)
            ranked_states = sorted(live_states.values(), key=_frontier_rank)
            kept_states = ranked_states[:frontier_limit]
            if bucket_count > 1:
                endpoint_mask = first_bucket_bit | last_bucket_bit
                edge_candidates = [
                    state
                    for state in ranked_states
                    if (
                        state.timeline_bucket_mask & endpoint_mask
                    ) == endpoint_mask
                ]
                if not edge_candidates:
                    edge_candidates = [
                        state
                        for state in ranked_states
                        if state.timeline_bucket_mask & last_bucket_bit
                    ]
                if edge_candidates:
                    edge_state = min(edge_candidates, key=_frontier_rank)
                    if edge_state not in kept_states:
                        kept_states[-1] = edge_state
            states = {
                _state_key(state): state
                for state in kept_states
            }
            frontier_high_water_mark = max(
                frontier_high_water_mark,
                len(states),
            )
            _int_log.warning(
                "NARRATIVE_ALLOCATOR frontier pruned frontier_before=%d "
                "next_frontier_before_prune=%d frontier_after=%d position=%d "
                "high_water_mark=%d search_truncated=true",
                frontier_before,
                next_frontier_before_prune,
                len(states),
                position + 1,
                frontier_high_water_mark,
            )
        else:
            states = live_states
            frontier_high_water_mark = max(
                frontier_high_water_mark,
                len(states),
            )
        if not states:
            break

    def _satisfies_story_arc(state: _State) -> bool:
        return state.essential_mask == all_essential_mask

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
            raise AllocationError(
                f"No whole-block allocation satisfies duration window [{min_ms}, {max_ms}]"
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
        best = _select_best(non_empty)
        is_fallback = True
    else:
        best = _select_best(feasible)
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
