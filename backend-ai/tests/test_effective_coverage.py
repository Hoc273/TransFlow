"""Regression tests for the canonical source-coverage accounting.

Guards the final NarrativePlan coverage invariant
(`narrative_summarize_gateway.py`): the render representation — the union
over the actual output `plan.sections[].source_refs`, exactly what
backend-main merges into cut ranges (`mergedSourceRefs`) — must equal the
allocation total with exact equality. No tolerance.

Historical bug: presentation cuts landing on allocator-bridged sub-2000ms
silences dropped them from the ref spans (e.g. -870ms on a dense 531s
transcript compressed to a 300s target) and failed jobs deterministically.
The fix assigns cut-through bridged gaps deterministically to the adjacent
render ref; these tests lock that contract at the plan layer, not just on
internal allocation blocks.
"""
from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.services.allocator import (
    AllocationError,
    allocate_blocks,
    compute_effective_coverage_ms,
    is_bridged_gap,
    _coverage_increment,
)
from app.services.narrative_planning_models import (
    BlockRanking,
    NarrativeDraft,
    SemanticPlan,
    SemanticSection,
    TranscriptBlock,
    WrittenSection,
)
from app.services.narrative_summarize_gateway import (
    _build_plan,
    _build_transcript_blocks,
    _final_coverages,
    _presentation_source_refs,
    _render_coverage_ms,
    _resolve_beat_budget,
    _split_for_presentation,
    split_distant_blocks_into_sections,
)
from app.services.timing_boundaries import SILENCE_BOUNDARY_MS


def _tb(block_id: str, start_ms: int, end_ms: int, order: int) -> TranscriptBlock:
    return TranscriptBlock(
        block_id=block_id,
        start_ms=start_ms,
        end_ms=end_ms,
        duration_ms=end_ms - start_ms,
        text_preview=block_id,
        ordered_index=order,
        full_text=block_id,
    )


def _owners(n_blocks: int, n_sections: int) -> list[str]:
    per = max(1, n_blocks // n_sections)
    return [f"S{min(i // per, n_sections - 1) + 1:03d}" for i in range(n_blocks)]


def _contiguous_plan(blocks: list[TranscriptBlock], n_sections: int) -> SemanticPlan:
    """Valid semantic plan with contiguous section ownership (LLM-like)."""
    owners = _owners(len(blocks), n_sections)
    section_ids = list(dict.fromkeys(owners))
    return SemanticPlan(
        sections=[SemanticSection(section_id=sid, goal=f"Goal {sid}") for sid in section_ids],
        block_rankings=[
            BlockRanking(
                block_id=b.block_id,
                importance=max(0.05, 1.0 - i * 0.004),
                section_id=owner,
            )
            for i, (b, owner) in enumerate(zip(blocks, owners))
        ],
        title="Coverage test plan",
    )


def _dense_segments(
    count: int = 78,
    gap_mul: int = 7919,
    gap_mod: int = 2200,
    gap_base: int = 300,
    dur_mul: int = 104729,
    dur_mod: int = 3000,
    dur_base: int = 4000,
) -> list[dict]:
    """Deterministic dense transcript: large total silence, every gap small.

    Mimics the failing production asset (~531s, 78 segments, ~102s silence
    with 66/77 gaps below 2000ms and no clean cut point above ~2.8s).
    """
    segments: list[dict] = []
    cursor = 2410
    for i in range(count):
        if i:
            cursor += gap_base + (i * gap_mul) % gap_mod
        duration = dur_base + (i * dur_mul) % dur_mod
        segments.append(
            {"text": f"segment {i}", "start_ms": cursor, "end_ms": cursor + duration}
        )
        cursor += duration
    return segments


# Gap pattern proven (via scratch exploration) to drive presentation cuts
# through allocator-bridged silences: legacy merged-refs accounting loses
# ~3.6s while the canonical computation stays exact.
_BITING_GAPS = {"gap_mul": 10427, "gap_mod": 2300, "gap_base": 250}


def _run_deterministic_chain(blocks, target_ms, n_sections, cap):
    """Mirror the unbounded gateway path: allocate -> splits -> coverages.

    Canonical coverage is computed exactly like the final invariant: keyed
    intervals plus the ranking section map. `legacy_ms` reproduces the OLD
    (pre-fix) behavior — merged refs with no cross-beat gap assignment.
    """
    _ = cap  # Legacy callers still pass a beat budget; presentation count is unbounded.
    owners = _owners(len(blocks), n_sections)
    section_for_index = {b.ordered_index: owner for b, owner in zip(blocks, owners)}
    allocation = allocate_blocks(
        blocks, target_ms, _contiguous_plan(blocks, n_sections),
        allow_fallback=True,
    )
    split_sections = split_distant_blocks_into_sections(
        allocation.sections, max_gap_ms=SILENCE_BOUNDARY_MS
    )
    allocation = allocation.model_copy(update={"sections": split_sections})
    allocation, visual_refs = _split_for_presentation(
        allocation, None, section_for_index=section_for_index
    )
    final_sections = allocation.sections
    canonical_ms = compute_effective_coverage_ms(
        [
            (int(b.start_ms), int(b.end_ms), int(b.ordered_index))
            for section in final_sections
            for b in section.blocks
        ],
        section_for_index=section_for_index,
    )
    legacy_refs = _presentation_source_refs(final_sections, None)
    legacy_ms = sum(e - s for ranges in legacy_refs.values() for s, e in ranges)
    return allocation, canonical_ms, legacy_ms, final_sections, visual_refs


def _build_test_plan(allocation, visual_refs, target_ms=300_000):
    """Build a real NarrativePlan through the production `_build_plan`."""
    final_sections = allocation.sections
    req = SimpleNamespace(language="vi", target_duration_ms=target_ms)
    draft = NarrativeDraft(
        sections=[
            WrittenSection(
                section_id=s.section_id,
                script_source_lang=f"Beat {s.section_id} narration.",
                generate_terms=["scene", "action", "detail", "moment", "highlight"],
            )
            for s in final_sections
        ],
        title="Coverage test draft",
    )
    semantic_plan = SemanticPlan(sections=[], block_rankings=[], title="t")
    return _build_plan(
        req,
        semantic_plan,
        allocation,
        draft,
        visual_refs_by_section=visual_refs,
        visual_grounding_degraded=True,
        validate_narrative=False,
    )


class BridgedGapRuleTest(unittest.TestCase):
    def test_boundary_values(self):
        self.assertFalse(is_bridged_gap(0))
        self.assertFalse(is_bridged_gap(-5))
        self.assertTrue(is_bridged_gap(1))
        self.assertTrue(is_bridged_gap(1999))
        # The threshold itself is a presentation discontinuity, never bridged.
        self.assertFalse(is_bridged_gap(2000))
        self.assertFalse(is_bridged_gap(2001))

    def test_custom_threshold(self):
        self.assertTrue(is_bridged_gap(1500, bridge_gap_ms=2000))
        self.assertFalse(is_bridged_gap(1500, bridge_gap_ms=1500))
        self.assertFalse(is_bridged_gap(1500, bridge_gap_ms=1000))


class EffectiveCoverageHelperTest(unittest.TestCase):
    def test_single_interval(self):
        self.assertEqual(compute_effective_coverage_ms([(0, 1000, 1)]), 1000)

    def test_empty_input(self):
        self.assertEqual(compute_effective_coverage_ms([]), 0)

    def test_bridges_consecutive_sub_threshold_gap(self):
        self.assertEqual(
            compute_effective_coverage_ms([(0, 1000, 1), (1500, 2500, 2)]),
            2500,  # 1000 + 1000 + bridged 500
        )

    def test_gap_exactly_at_threshold_not_bridged(self):
        self.assertEqual(
            compute_effective_coverage_ms([(0, 1000, 1), (3000, 4000, 2)]),
            2000,
        )

    def test_zero_gap_adds_nothing(self):
        self.assertEqual(
            compute_effective_coverage_ms([(0, 1000, 1), (1000, 2000, 2)]),
            2000,
        )

    def test_skipped_block_gap_never_bridged(self):
        # Non-consecutive canonical keys: a skipped block sits between them,
        # so the allocator never bridged this gap either.
        self.assertEqual(
            compute_effective_coverage_ms([(0, 1000, 1), (1500, 2500, 3)]),
            2000,
        )

    def test_overlapping_intervals_merged_without_double_count(self):
        self.assertEqual(
            compute_effective_coverage_ms([(0, 1000, 1), (500, 1500, 2)]),
            1500,
        )

    def test_duplicate_refs_deduplicated(self):
        self.assertEqual(
            compute_effective_coverage_ms(
                [(0, 1000, 1), (0, 1000, 1), (1200, 2200, 2)]
            ),
            2200,  # 1000 + 1000 + bridged 200
        )

    def test_out_of_order_input_is_sorted(self):
        self.assertEqual(
            compute_effective_coverage_ms(
                [(1500, 2500, 2), (0, 1000, 1), (300, 400, 1)]
            ),
            2500,
        )

    def test_degenerate_intervals_dropped(self):
        # Keys 1 -> 4 are not consecutive, so the 200ms gap stays unbridged
        # even though it is sub-threshold: exact allocator semantics.
        self.assertEqual(
            compute_effective_coverage_ms(
                [(0, 1000, 1), (500, 500, 2), (900, 800, 3), (1200, 2200, 4)]
            ),
            2000,
        )

    def test_unkeyed_mode_bridges_every_sub_threshold_gap(self):
        self.assertEqual(
            compute_effective_coverage_ms([(0, 1000), (1500, 2500)]),
            2500,
        )
        self.assertEqual(
            compute_effective_coverage_ms([(0, 1000), (3000, 4000)]),
            2000,
        )

    def test_mixed_keyed_and_unkeyed_raises(self):
        with self.assertRaises(AllocationError):
            compute_effective_coverage_ms([(0, 1000, 1), (1500, 2500)])

    def test_section_map_blocks_cross_section_bridge(self):
        # Consecutive keys with a sub-threshold gap, but different ranking
        # sections: the allocator leaves this gap separate, so must we.
        items = [(0, 1000, 1), (1500, 2500, 2)]
        section_map = {1: "S001", 2: "S002"}
        self.assertEqual(
            compute_effective_coverage_ms(items, section_for_index=section_map), 2000
        )

    def test_section_map_allows_same_section_bridge(self):
        items = [(0, 1000, 1), (1500, 2500, 2)]
        section_map = {1: "S001", 2: "S001"}
        self.assertEqual(
            compute_effective_coverage_ms(items, section_for_index=section_map), 2500
        )

    def test_section_map_without_keys_raises(self):
        with self.assertRaises(AllocationError):
            compute_effective_coverage_ms(
                [(0, 1000), (1500, 2500)], section_for_index={1: "S001"}
            )

    def test_missing_key_in_section_map_never_bridges(self):
        # Fail closed: unknown keys stay separate.
        items = [(0, 1000, 1), (1500, 2500, 2)]
        self.assertEqual(
            compute_effective_coverage_ms(items, section_for_index={1: "S001"}), 2000
        )

    def test_malformed_item_raises(self):
        with self.assertRaises(AllocationError):
            compute_effective_coverage_ms([(0, 1000, 1, "extra")])

    def test_dozens_of_small_gaps(self):
        intervals = []
        cursor = 0
        for i in range(1, 41):
            intervals.append((cursor, cursor + 5000, i))
            cursor += 5000 + 700  # every gap bridged
        # 40 x 5000 speech + 39 x 700 bridged silence.
        self.assertEqual(
            compute_effective_coverage_ms(intervals), 40 * 5000 + 39 * 700
        )


class AllocatorConsistencyTest(unittest.TestCase):
    """The canonical helper must reproduce _coverage_increment accumulation."""

    def test_matches_incremental_accounting_on_deterministic_selections(self):
        blocks = _dense_like_blocks()
        section_for_index = {i: f"S{(i // 4) + 1:03d}" for i in range(len(blocks))}
        selections = [
            tuple(range(len(blocks))),
            tuple(range(0, len(blocks), 2)),
            tuple(range(1, len(blocks), 3)),
            (0, 1, 2, 5, 6, 7, 8, 11, 12, 15, 16, 19),
            (3, 4, 9, 10, 13, 14, 17, 18),
        ]
        for indices in selections:
            indices = tuple(i for i in indices if i < len(blocks))
            expected = 0
            prev = -1
            for pos in indices:
                expected += _coverage_increment(
                    blocks, prev, pos, section_for_index
                )
                prev = pos
            actual = compute_effective_coverage_ms(
                [
                    (blocks[i].start_ms, blocks[i].end_ms, blocks[i].ordered_index)
                    for i in indices
                ]
            )
            # The helper has no section map, so it additionally bridges
            # consecutive cross-section gaps the allocator leaves separate.
            # That delta must equal exactly those gaps — nothing else.
            cross_section_bridged = 0
            for prev_pos, pos in zip(indices, indices[1:]):
                if pos != prev_pos + 1:
                    continue
                if section_for_index[pos] == section_for_index[prev_pos]:
                    continue
                gap = blocks[pos].start_ms - blocks[prev_pos].end_ms
                if 0 < gap < SILENCE_BOUNDARY_MS:
                    cross_section_bridged += gap
            self.assertEqual(actual - expected, cross_section_bridged)
            # Same-section-only selections must match exactly.
            same_section = all(
                section_for_index[pos] == section_for_index[indices[0]]
                for pos in indices
            )
            if same_section:
                self.assertEqual(actual, expected)
            # With the section map, the helper reproduces the allocator
            # exactly on EVERY selection — this is the invariant's contract.
            with_map = compute_effective_coverage_ms(
                [
                    (blocks[i].start_ms, blocks[i].end_ms, blocks[i].ordered_index)
                    for i in indices
                ],
                section_for_index={
                    b.ordered_index: section_for_index[i]
                    for i, b in enumerate(blocks)
                },
            )
            self.assertEqual(with_map, expected)


def _dense_like_blocks(count: int = 30) -> list[TranscriptBlock]:
    segments = _dense_segments(count)
    return [
        _tb(f"B{i + 1:03d}", seg["start_ms"], seg["end_ms"], i + 1)
        for i, seg in enumerate(segments)
    ]


def _section_map(blocks, n_sections) -> dict[int, str]:
    owners = _owners(len(blocks), n_sections)
    return {b.ordered_index: owner for b, owner in zip(blocks, owners)}


class PresentationSplitInvarianceTest(unittest.TestCase):
    """Property: render union over the final plan == allocation.coverage_ms
    for any beat count. Splits may repartition beats but never change the
    rendered total. Checked through the exact production computation
    (`_final_coverages`) on real plans built by `_build_plan`."""

    def _assert_invariant(self, blocks, target_ms, n_sections, caps):
        section_map = _section_map(blocks, n_sections)
        for cap in caps:
            allocation, _, _, final_sections, visual_refs = _run_deterministic_chain(
                blocks, target_ms, n_sections, cap
            )
            plan = _build_test_plan(allocation, visual_refs, target_ms)
            render_ms, canonical_ms = _final_coverages(plan, allocation, section_map)
            self.assertEqual(
                canonical_ms,
                allocation.coverage_ms,
                f"cap={cap} beats={len(final_sections)}",
            )
            self.assertEqual(
                render_ms,
                allocation.coverage_ms,
                f"cap={cap} beats={len(final_sections)}",
            )

    def test_invariant_holds_across_beat_budgets(self):
        # Production shape: grouped canonical blocks (78 segments -> ~17
        # blocks), subdivided into 20+ beats by the presentation splits.
        blocks = _build_transcript_blocks(_dense_segments(78))
        self._assert_invariant(blocks, 300_000, 3, caps=[24, 28, 32])
        # Sanity: the fixture really does reach the 20-30 beat regime.
        _, _, _, final_sections, _ = _run_deterministic_chain(
            blocks, 300_000, 3, 32
        )
        self.assertGreaterEqual(len(final_sections), 20)

    def test_invariant_holds_near_full_source_target(self):
        blocks = _build_transcript_blocks(_dense_segments(78))
        total = compute_effective_coverage_ms(
            [(b.start_ms, b.end_ms, b.ordered_index) for b in blocks]
        )
        self._assert_invariant(blocks, total, 3, caps=[32])

    def test_invariant_holds_with_large_silences(self):
        # Sparse transcript: every gap exceeds the bridge threshold.
        sparse = []
        cursor = 0
        for i in range(1, 21):
            sparse.append(_tb(f"B{i:03d}", cursor, cursor + 8000, i))
            cursor += 8000 + 3500
        self._assert_invariant(sparse, 120_000, 2, caps=[6, 12, 18])

    def test_missing_block_breaks_the_invariant(self):
        # Dropping exactly one selected block must fail exact equality:
        # tolerance would hide real content loss, so none is allowed.
        blocks = _dense_like_blocks()
        allocation, canonical_ms, _, final_sections, _ = _run_deterministic_chain(
            blocks, 300_000, 3, 24
        )
        self.assertEqual(canonical_ms, allocation.coverage_ms)
        items = [
            (int(b.start_ms), int(b.end_ms), int(b.ordered_index))
            for section in final_sections
            for b in section.blocks
        ]
        self.assertGreater(len(items), 2)
        without_one = items[:-1]
        self.assertNotEqual(
            compute_effective_coverage_ms(without_one), allocation.coverage_ms
        )


class DenseTranscriptFixtureTest(unittest.TestCase):
    """End-to-end deterministic chain on a production-like dense transcript.

    78 segments / ~102s total silence with nearly every gap below 2000ms,
    compressed to a 300s target: the exact shape that failed production jobs
    with `Final NarrativePlan coverage invariant failed`.
    """

    def test_dense_531s_to_300s_keeps_exact_coverage(self):
        blocks = _build_transcript_blocks(_dense_segments(78, **_BITING_GAPS))
        self.assertGreater(len(blocks), 5)
        cap = _resolve_beat_budget(300_000, None)
        for n_sections in (2, 3, 4):
            allocation, _, legacy_ms, final_sections, visual_refs = (
                _run_deterministic_chain(blocks, 300_000, n_sections, cap)
            )
            self.assertFalse(allocation.is_fallback)
            section_map = _section_map(blocks, n_sections)
            # The verdict requirement: the FINAL RENDER coverage — union over
            # the actual output plan refs — equals the allocation total.
            plan = _build_test_plan(allocation, visual_refs)
            render_ms, canonical_ms = _final_coverages(plan, allocation, section_map)
            self.assertEqual(
                canonical_ms, allocation.coverage_ms, f"n_sections={n_sections}"
            )
            self.assertEqual(
                render_ms, allocation.coverage_ms, f"n_sections={n_sections}"
            )
            # …while the legacy merged-refs sum demonstrably loses bridged
            # gaps on this fixture shape (guards against a vacuous test).
            lost = _lost_bridged_gap_ms(final_sections, section_map)
            self.assertGreater(lost, 0, f"n_sections={n_sections}")
            self.assertEqual(
                legacy_ms, allocation.coverage_ms - lost, f"n_sections={n_sections}"
            )

    def test_dense_fixture_near_full_target(self):
        blocks = _build_transcript_blocks(_dense_segments(78))
        total = compute_effective_coverage_ms(
            [(b.start_ms, b.end_ms, b.ordered_index) for b in blocks]
        )
        cap = _resolve_beat_budget(total, None)
        allocation, _, _, _, visual_refs = _run_deterministic_chain(
            blocks, total, 3, cap
        )
        plan = _build_test_plan(allocation, visual_refs, total)
        render_ms, canonical_ms = _final_coverages(
            plan, allocation, _section_map(blocks, 3)
        )
        self.assertEqual(canonical_ms, allocation.coverage_ms)
        self.assertEqual(render_ms, allocation.coverage_ms)


class FinalPlanContractTest(unittest.TestCase):
    """The invariant measures the actual output plan.

    Mutations apply to `plan.sections[].source_refs` — the exact render
    representation backend-main merges — and are checked with the exact
    production computation (`_final_coverages`). If `_build_plan` ever drops
    a source ref while allocation blocks stay intact, these fail.
    """

    def _intact_plan(self):
        blocks = _build_transcript_blocks(_dense_segments(78, **_BITING_GAPS))
        cap = _resolve_beat_budget(300_000, None)
        allocation, _, _, _, visual_refs = _run_deterministic_chain(
            blocks, 300_000, 3, cap
        )
        plan = _build_test_plan(allocation, visual_refs)
        return allocation, plan, _section_map(blocks, 3)

    def _first_nonempty_section(self, plan):
        for section in plan.sections:
            if section.source_refs:
                return section
        raise AssertionError("plan has no source refs at all")

    def test_intact_plan_passes(self):
        allocation, plan, section_map = self._intact_plan()
        render_ms, canonical_ms = _final_coverages(plan, allocation, section_map)
        self.assertEqual(render_ms, allocation.coverage_ms)
        self.assertEqual(canonical_ms, allocation.coverage_ms)

    def test_dropping_a_final_ref_breaks_the_invariant(self):
        allocation, plan, section_map = self._intact_plan()
        section = self._first_nonempty_section(plan)
        section.source_refs = section.source_refs[1:]
        render_ms, canonical_ms = _final_coverages(plan, allocation, section_map)
        self.assertNotEqual(render_ms, allocation.coverage_ms)
        # Internal block accounting is untouched: the failure is isolated to
        # the render layer — exactly the blind spot of the old check.
        self.assertEqual(canonical_ms, allocation.coverage_ms)

    def test_truncating_a_final_ref_breaks_the_invariant(self):
        allocation, plan, section_map = self._intact_plan()
        section = self._first_nonempty_section(plan)
        ref = section.source_refs[0]
        shrunk_end = max(int(ref.start_ms) + 1, int(ref.end_ms) - 500)
        self.assertLess(shrunk_end, int(ref.end_ms))
        section.source_refs[0] = ref.model_copy(
            update={"end_ms": shrunk_end}
        )
        render_ms, canonical_ms = _final_coverages(plan, allocation, section_map)
        self.assertNotEqual(render_ms, allocation.coverage_ms)
        self.assertEqual(canonical_ms, allocation.coverage_ms)


def _lost_bridged_gap_ms(final_sections, section_for_index) -> int:
    """Sum of allocator-bridged gaps separated by inter-beat cuts.

    Groups final sub-block tiles by canonical key (tiles share the parent
    key and are contiguous, so per-key union is exact), then sums sub-2000ms
    gaps between consecutive keys that (a) share a ranking section — the only
    gaps the allocator ever bridged — and (b) landed in different beats.
    """
    flat: list[tuple[int, int, int, str]] = []
    sec_of: dict[str, str] = {}
    for section in final_sections:
        for b in section.blocks:
            flat.append((b.ordered_index, b.start_ms, b.end_ms, b.block_id))
            sec_of.setdefault(b.block_id, section.section_id)
    flat.sort()
    # Recompute on canonical keys: group by key, use span union per key.
    by_key: dict[int, list[tuple[int, int, str]]] = {}
    for order, start, end, bid in flat:
        by_key.setdefault(order, []).append((start, end, bid))
    keys = sorted(by_key)
    lost = 0
    for prev_key, cur_key in zip(keys, keys[1:]):
        if cur_key != prev_key + 1:
            continue
        if section_for_index.get(prev_key) != section_for_index.get(cur_key):
            continue  # never bridged by the allocator
        prev_end = max(e for _, e, _ in by_key[prev_key])
        cur_start = min(s for s, _, _ in by_key[cur_key])
        prev_sec = sec_of[by_key[prev_key][0][2]]
        cur_sec = sec_of[by_key[cur_key][0][2]]
        gap = cur_start - prev_end
        if 0 < gap < SILENCE_BOUNDARY_MS and prev_sec != cur_sec:
            lost += gap
    return lost


if __name__ == "__main__":
    unittest.main()
