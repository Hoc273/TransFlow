"""CT5.7 deterministic whole-block allocator tests."""
from __future__ import annotations

import unittest
from unittest.mock import patch

import app.services.allocator as allocator_module
from app.services.allocator import (
    AllocationError,
    allocate_blocks,
    chronology_coverage_metrics,
    duration_window,
    source_coverage_target_representable,
)
from app.services.narrative_planning_models import (
    AllocatedSection,
    BlockRanking,
    SemanticPlan,
    SemanticSection,
    TranscriptBlock,
)
from app.services.narrative_summarize_gateway import (
    _presentation_source_refs,
    split_distant_blocks_into_sections,
)


def _blocks(durations: list[int]) -> list[TranscriptBlock]:
    result: list[TranscriptBlock] = []
    cursor = 0
    for index, duration in enumerate(durations, start=1):
        result.append(
            TranscriptBlock(
                block_id=f"B{index:03d}",
                start_ms=cursor,
                end_ms=cursor + duration,
                duration_ms=duration,
                text_preview=f"Block {index}",
                ordered_index=index,
                full_text=f"Full block {index}",
            )
        )
        cursor += duration
    return result


def _plan(blocks: list[TranscriptBlock], scores: list[float], owners: list[str] | None = None) -> SemanticPlan:
    if owners is None:
        owners = ["S001"] * len(blocks)
    section_ids = list(dict.fromkeys(owners))
    return SemanticPlan(
        sections=[
            SemanticSection(section_id=section_id, goal=f"Goal {section_id}")
            for section_id in section_ids
        ],
        block_rankings=[
            BlockRanking(block_id=block.block_id, importance=score, section_id=owner)
            for block, score, owner in zip(blocks, scores, owners)
        ],
    )


def _gapped_blocks(count: int, duration: int, gap: int) -> list[TranscriptBlock]:
    result: list[TranscriptBlock] = []
    cursor = 0
    for index in range(1, count + 1):
        result.append(
            TranscriptBlock(
                block_id=f"B{index:03d}",
                start_ms=cursor,
                end_ms=cursor + duration,
                duration_ms=duration,
                text_preview=f"Block {index}",
                ordered_index=index,
                full_text=f"Full block {index}",
            )
        )
        cursor += duration + gap
    return result


def _timeline_blocks(count: int = 18) -> list[TranscriptBlock]:
    return _gapped_blocks(count, duration=25_000, gap=5_000)


def _long_form_prefix_bias_fixture() -> tuple[list[TranscriptBlock], SemanticPlan]:
    blocks = _gapped_blocks(52, duration=20_000, gap=1_500)
    owners = [
        "S001" if block.ordered_index <= 4
        else "S002" if 25 <= block.ordered_index <= 28
        else "S003"
        for block in blocks
    ]
    return blocks, SemanticPlan(
        sections=[
            SemanticSection(section_id="S001", goal="Opening", essential=True),
            SemanticSection(section_id="S002", goal="Mid-story turning point", essential=True),
            SemanticSection(section_id="S003", goal="Supporting story detail"),
        ],
        block_rankings=[
            BlockRanking(
                block_id=block.block_id,
                importance=1.0 if block.ordered_index <= 36 else 0.1,
                section_id=owner,
            )
            for block, owner in zip(blocks, owners)
        ],
    )


def _incident_shaped_fixture() -> tuple[list[TranscriptBlock], SemanticPlan]:
    blocks: list[TranscriptBlock] = []
    owners: list[str] = []
    sections: list[SemanticSection] = []
    cursor = 0
    block_index = 0
    for section_index in range(1, 28):
        section_id = f"S{section_index:03d}"
        sections.append(
            SemanticSection(
                section_id=section_id,
                goal=f"Cover narrative section {section_index}",
                essential=section_index <= 18,
                preferred_blocks=[f"B{block_index + 1:03d}"]
                if section_index % 3 == 0
                else [],
            )
        )
        block_count = 4 if section_index == 1 else 3
        for _ in range(block_count):
            block_index += 1
            duration = 3_701 + ((block_index * 173) % 1_499)
            start_ms = cursor
            end_ms = start_ms + duration
            blocks.append(
                TranscriptBlock(
                    block_id=f"B{block_index:03d}",
                    start_ms=start_ms,
                    end_ms=end_ms,
                    duration_ms=duration,
                    text_preview=f"Incident block {block_index}",
                    ordered_index=block_index,
                    full_text=f"Incident full block {block_index}",
                )
            )
            owners.append(section_id)
            cursor = end_ms + 1_137 + ((block_index * 29) % 401)

    plan = SemanticPlan(
        sections=sections,
        block_rankings=[
            BlockRanking(
                block_id=block.block_id,
                importance=0.2 + ((index * 37) % 79) / 100,
                section_id=owner,
            )
            for index, (block, owner) in enumerate(zip(blocks, owners), start=1)
        ],
    )
    return blocks, plan


class DurationWindowTest(unittest.TestCase):
    def test_uses_fixed_tolerance_through_ninety_seconds(self):
        self.assertEqual(duration_window(60_000), (50_000, 70_000))
        self.assertEqual(duration_window(90_000), (80_000, 100_000))

    def test_uses_ten_percent_tolerance_above_ninety_seconds(self):
        self.assertEqual(duration_window(180_000), (162_000, 198_000))


class DeterministicAllocatorTest(unittest.TestCase):
    def test_sparse_coverage_can_fit_with_at_most_twelve_presentation_units(self):
        blocks = _gapped_blocks(12, 25_000, 1_000)
        result = allocate_blocks(
            blocks,
            300_000,
            _plan(blocks, [0.5] * len(blocks)),
            max_sections=12,
        )

        split = split_distant_blocks_into_sections(
            result.sections,
            max_gap_ms=2_000,
            max_sections=12,
        )
        self.assertEqual(result.coverage_ms, 311_000)
        self.assertEqual(len(result.selected_blocks), 12)
        self.assertEqual(len(split), 1)
        self.assertEqual(
            _presentation_source_refs(split),
            {"S001": [(0, 311_000)]},
        )

    def test_sparse_coverage_is_feasible_without_a_presentation_unit_cap(self):
        blocks = _gapped_blocks(13, 22_000, 2_000)

        result = allocate_blocks(
            blocks,
            300_000,
            _plan(blocks, [0.5] * len(blocks)),
            max_sections=12,
        )
        self.assertGreaterEqual(result.coverage_ms, 270_000)
        self.assertLessEqual(result.coverage_ms, 330_000)

    def test_adjacent_block_indices_with_large_timestamp_gap_are_two_units(self):
        blocks = _gapped_blocks(2, 30_000, 2_000)
        section = AllocatedSection(
            section_id="S001",
            title="Sparse",
            goal="Keep both ranges",
            blocks=blocks,
        )

        split = split_distant_blocks_into_sections(
            [section],
            max_gap_ms=2_000,
            max_sections=2,
        )

        self.assertEqual(len(split), 2)

    def test_grouping_boundary_small_gap_does_not_change_feasibility(self):
        contiguous = _gapped_blocks(13, 22_000, 0)
        natural_gap = _gapped_blocks(13, 22_000, 1_000)

        self.assertTrue(
            source_coverage_target_representable(
                contiguous, 300_000, max_sections=12
            )
        )
        self.assertTrue(
            source_coverage_target_representable(
                natural_gap, 300_000, max_sections=12
            )
        )

        contiguous_result = allocate_blocks(
            contiguous,
            300_000,
            _plan(contiguous, [0.5] * len(contiguous)),
            max_sections=12,
        )
        result = allocate_blocks(
            natural_gap,
            300_000,
            _plan(natural_gap, [0.5] * len(natural_gap)),
            max_sections=12,
        )
        self.assertEqual(
            [block.block_id for block in contiguous_result.selected_blocks],
            [block.block_id for block in result.selected_blocks],
        )
        split = split_distant_blocks_into_sections(
            result.sections,
            max_gap_ms=2_000,
            max_sections=12,
        )
        self.assertEqual(len(split), 1)
        self.assertEqual(
            _presentation_source_refs(split),
            {"S001": [(0, 298_000)]},
        )

    def test_gap_above_natural_threshold_does_not_make_coverage_infeasible(self):
        blocks = _gapped_blocks(13, 22_000, 2_001)

        self.assertTrue(
            source_coverage_target_representable(
                blocks, 300_000, max_sections=12
            )
        )
        result = allocate_blocks(
            blocks,
            300_000,
            _plan(blocks, [0.5] * len(blocks)),
            max_sections=12,
        )
        self.assertGreaterEqual(result.coverage_ms, 270_000)

    def test_natural_pause_is_bridged_but_exact_boundary_is_not(self):
        natural = _gapped_blocks(2, 30_000, 1_999)
        boundary = _gapped_blocks(2, 30_000, 2_000)
        natural_section = AllocatedSection(
            section_id="S001",
            title="Natural",
            goal="Keep natural continuity",
            blocks=natural,
        )
        boundary_section = natural_section.model_copy(
            update={"blocks": boundary, "title": "Boundary"}
        )

        self.assertEqual(
            _presentation_source_refs([natural_section]),
            {"S001": [(0, 61_999)]},
        )
        self.assertEqual(
            _presentation_source_refs([boundary_section]),
            {"S001": [(0, 30_000), (32_000, 62_000)]},
        )

    def test_semantic_owner_change_starts_a_new_presentation_unit(self):
        blocks = _blocks([30_000, 30_000])

        result = allocate_blocks(
            blocks,
            60_000,
            _plan(blocks, [0.5, 0.5], owners=["S001", "S002"]),
            max_sections=1,
        )
        self.assertEqual(result.coverage_ms, 60_000)

    def test_preserves_lower_score_state_with_more_section_budget(self):
        blocks = _blocks([40_000, 40_000, 20_000, 40_000])
        plan = SemanticPlan(
            sections=[
                SemanticSection(section_id="S001", goal="Build context"),
                SemanticSection(section_id="S002", goal="Deliver payoff", essential=True),
            ],
            block_rankings=[
                BlockRanking(block_id="B001", importance=0.9, section_id="S001"),
                BlockRanking(block_id="B002", importance=0.1, section_id="S001"),
                BlockRanking(block_id="B003", importance=0.1, section_id="S001"),
                BlockRanking(block_id="B004", importance=0.2, section_id="S002"),
            ],
        )

        result = allocate_blocks(blocks, 100_000, plan, max_sections=2)

        self.assertEqual(
            [block.block_id for block in result.selected_blocks],
            ["B001", "B003", "B004"],
        )

    def test_preserves_explicit_story_arc_beats(self):
        blocks = _blocks([60_000] * 6)
        owners = ["S001", "S001", "S002", "S002", "S003", "S003"]
        plan = SemanticPlan(
            sections=[
                SemanticSection(
                    section_id="S001",
                    goal="Set up the story",
                    beat_hint="HOOK",
                    essential=True,
                ),
                SemanticSection(
                    section_id="S002",
                    goal="Show the central conflict",
                    beat_hint="RISING_ACTION",
                    essential=True,
                ),
                SemanticSection(
                    section_id="S003",
                    goal="Deliver the resolution",
                    beat_hint="PAYOFF",
                    essential=True,
                ),
            ],
            block_rankings=[
                BlockRanking(
                    block_id=block.block_id,
                    importance=0.9 if block.block_id in {"B003", "B006"} else 0.1,
                    section_id=owner,
                )
                for block, owner in zip(blocks, owners)
            ],
        )

        result = allocate_blocks(blocks, 180_000, plan)

        self.assertEqual(result.coverage_ms, 180_000)
        self.assertEqual(
            [block.block_id for block in result.selected_blocks],
            ["B001", "B003", "B006"],
        )

    def test_fails_closed_when_explicit_essentials_cannot_fit_budget(self):
        blocks = _blocks([60_000] * 4)
        plan = SemanticPlan(
            sections=[
                SemanticSection(section_id="S001", goal="Opening", essential=True),
                SemanticSection(section_id="S002", goal="Core", essential=True),
                SemanticSection(section_id="S003", goal="Resolution", essential=True),
                SemanticSection(section_id="S004", goal="Nonessential context"),
            ],
            block_rankings=[
                BlockRanking(
                    block_id=block.block_id,
                    importance=0.99 if block.block_id == "B004" else 0.1,
                    section_id=f"S{index:03d}",
                )
                for index, block in enumerate(blocks, start=1)
            ],
        )

        with self.assertRaisesRegex(
            AllocationError,
            "Explicitly essential sections cannot fit the allocation budget",
        ):
            allocate_blocks(blocks, 120_000, plan, allow_fallback=True)

    def test_selects_exact_target_when_available(self):
        blocks = _blocks([60_000, 60_000, 60_000])
        result = allocate_blocks(blocks, 120_000, _plan(blocks, [0.9, 0.8, 0.1]))

        self.assertEqual(result.coverage_ms, 120_000)
        self.assertEqual([block.block_id for block in result.selected_blocks], ["B001", "B003"])

    def test_endpoint_coverage_beats_exact_prefix_inside_duration_window(self):
        blocks = _blocks([60_000, 60_000, 55_000])
        plan = SemanticPlan(
            sections=[
                SemanticSection(section_id="S001", goal="Opening", essential=True),
                SemanticSection(section_id="S002", goal="Resolution"),
            ],
            block_rankings=[
                BlockRanking(
                    block_id=block.block_id,
                    importance=score,
                    section_id="S001" if block.ordered_index == 1 else "S002",
                )
                for block, score in zip(blocks, [1.0, 0.9, 0.1])
            ],
        )

        first = allocate_blocks(blocks, 120_000, plan, max_sections=4)
        second = allocate_blocks(blocks, 120_000, plan, max_sections=4)
        metrics = chronology_coverage_metrics(
            blocks,
            first.selected_blocks,
            120_000,
            presentation_cap=4,
        )
        min_ms, max_ms = duration_window(120_000)

        self.assertGreaterEqual(first.coverage_ms, min_ms)
        self.assertLessEqual(first.coverage_ms, max_ms)
        self.assertEqual(first.coverage_ms, 115_000)
        self.assertEqual(
            [block.block_id for block in first.selected_blocks],
            ["B001", "B003"],
        )
        self.assertIn("S001", [section.section_id for section in first.sections])
        self.assertLessEqual(len(first.sections), 4)
        self.assertTrue(metrics["first_bucket_covered"])
        self.assertTrue(metrics["last_bucket_covered"])
        self.assertEqual(
            [block.ordered_index for block in first.selected_blocks],
            sorted(block.ordered_index for block in first.selected_blocks),
        )
        self.assertEqual(
            [block.block_id for block in first.selected_blocks],
            [block.block_id for block in second.selected_blocks],
        )

    def test_accepts_inclusive_lower_and_upper_boundaries(self):
        lower_blocks = _blocks([50_000])
        upper_blocks = _blocks([70_000])

        lower = allocate_blocks(lower_blocks, 60_000, _plan(lower_blocks, [0.5]))
        upper = allocate_blocks(upper_blocks, 60_000, _plan(upper_blocks, [0.5]))

        self.assertEqual(lower.coverage_ms, 50_000)
        self.assertEqual(upper.coverage_ms, 70_000)

    def test_fails_closed_when_whole_block_allocation_is_impossible(self):
        blocks = _blocks([40_000, 40_000])

        with self.assertRaisesRegex(AllocationError, "No whole-block allocation satisfies"):
            allocate_blocks(blocks, 60_000, _plan(blocks, [0.9, 0.8]))

    def test_prefers_semantic_score_after_duration_distance(self):
        blocks = _blocks([60_000, 60_000, 60_000])
        result = allocate_blocks(
            blocks,
            120_000,
            _plan(blocks, [0.1, 0.9, 0.8]),
            max_sections=1,
        )

        self.assertEqual([block.block_id for block in result.selected_blocks], ["B001", "B003"])

    def test_prefers_chronology_before_continuity_after_equal_duration_and_score(self):
        blocks = _blocks([30_000, 30_000, 30_000, 30_000])
        result = allocate_blocks(blocks, 60_000, _plan(blocks, [0.5, 0.5, 0.5, 0.5]))

        self.assertEqual([block.block_id for block in result.selected_blocks], ["B001", "B004"])

    def test_preserves_source_order_and_groups_selected_blocks_by_section(self):
        blocks = _blocks([30_000, 30_000, 30_000, 30_000])
        plan = _plan(blocks, [0.9, 0.8, 0.7, 0.6], ["S001", "S001", "S002", "S002"])
        result = allocate_blocks(blocks, 90_000, plan)

        self.assertEqual([block.block_id for block in result.selected_blocks], ["B001", "B002", "B004"])
        self.assertEqual([section.section_id for section in result.sections], ["S001", "S002"])
        self.assertEqual(
            [[block.block_id for block in section.blocks] for section in result.sections],
            [["B001", "B002"], ["B004"]],
        )

    def test_output_is_reproducible(self):
        blocks = _blocks([30_000, 30_000, 30_000, 30_000])
        plan = _plan(blocks, [0.5, 0.5, 0.5, 0.5])

        outputs = [
            [block.block_id for block in allocate_blocks(blocks, 60_000, plan).selected_blocks]
            for _ in range(20)
        ]

        self.assertEqual(outputs, [["B001", "B004"]] * 20)

    def test_never_rewrites_or_trims_selected_ranges(self):
        blocks = _blocks([55_000, 55_000, 55_000])
        result = allocate_blocks(blocks, 110_000, _plan(blocks, [0.9, 0.8, 0.1]))

        selected_ranges = [(block.start_ms, block.end_ms) for block in result.selected_blocks]
        canonical_ranges = {(block.start_ms, block.end_ms) for block in blocks}
        self.assertTrue(all(item in canonical_ranges for item in selected_ranges))

    def test_timeline_edge_preference_is_applied_before_soft_preferred_block(self):
        blocks = _blocks([60_000, 60_000, 60_000])
        plan = SemanticPlan(
            sections=[
                SemanticSection(
                    section_id="S001",
                    goal="Keep the selected opening",
                    essential=True,
                ),
                SemanticSection(
                    section_id="S002",
                    goal="Deliver the payoff",
                    beat_hint="PAYOFF",
                    preferred_blocks=["B002"],
                ),
            ],
            block_rankings=[
                BlockRanking(
                    block_id=block.block_id,
                    importance=score,
                    section_id=owner,
                )
                for block, score, owner in zip(
                    blocks,
                    [0.1, 0.2, 0.9],
                    ["S001", "S002", "S002"],
                )
            ],
        )

        result = allocate_blocks(blocks, 120_000, plan)

        self.assertEqual(
            [block.block_id for block in result.selected_blocks],
            ["B001", "B003"],
        )

    def test_keeps_explicit_arc_sections_without_intro_or_credits(self):
        blocks = _blocks([30_000] * 5)
        owners = ["S000", "S001", "S002", "S003", "S004"]
        plan = SemanticPlan(
            sections=[
                SemanticSection(section_id="S000", goal="Logo intro"),
                SemanticSection(
                    section_id="S001",
                    goal="Open the story",
                    beat_hint="HOOK",
                    essential=True,
                ),
                SemanticSection(
                    section_id="S002",
                    goal="Show the core event",
                    beat_hint="CLIMAX",
                    essential=True,
                ),
                SemanticSection(
                    section_id="S003",
                    goal="Resolve the story",
                    beat_hint="RESOLUTION",
                    essential=True,
                ),
                SemanticSection(section_id="S004", goal="Credits"),
            ],
            block_rankings=[
                BlockRanking(
                    block_id=block.block_id,
                    importance=0.95 if owner in {"S001", "S002", "S003"} else 0.01,
                    section_id=owner,
                )
                for block, owner in zip(blocks, owners)
            ],
        )

        result = allocate_blocks(blocks, 90_000, plan)

        self.assertEqual(
            [block.block_id for block in result.selected_blocks],
            ["B002", "B003", "B004"],
        )

    def test_distributes_near_tie_coverage_across_source_timeline(self):
        blocks = _timeline_blocks()
        plan = SemanticPlan(
            sections=[SemanticSection(
                section_id="S001",
                goal="Cover the complete story",
                essential=True,
            )],
            block_rankings=[
                BlockRanking(
                    block_id=block.block_id,
                    importance=0.61 if block.ordered_index <= 12 else 0.60,
                    section_id="S001",
                )
                for block in blocks
            ],
        )

        result = allocate_blocks(blocks, 300_000, plan, max_sections=32)
        metrics = chronology_coverage_metrics(
            blocks, result.selected_blocks, 300_000
        )

        self.assertGreaterEqual(result.coverage_ms, 270_000)
        self.assertLessEqual(result.coverage_ms, 330_000)
        self.assertEqual(
            [block.ordered_index for block in result.selected_blocks],
            sorted(block.ordered_index for block in result.selected_blocks),
        )
        self.assertLessEqual(len(result.selected_blocks), 32)
        self.assertGreaterEqual(len(metrics["timeline_buckets_covered"]), 6)
        self.assertGreater(metrics["selected_run_count"], 3)

        clustered = blocks[:12]
        clustered_metrics = chronology_coverage_metrics(
            blocks, clustered, 300_000
        )
        self.assertGreater(
            len(metrics["timeline_buckets_covered"]),
            len(clustered_metrics["timeline_buckets_covered"]),
        )

    def test_long_form_prefix_bias_keeps_story_end_when_feasible(self):
        blocks, plan = _long_form_prefix_bias_fixture()

        first = allocate_blocks(blocks, 720_000, plan, max_sections=32)
        second = allocate_blocks(blocks, 720_000, plan, max_sections=32)
        metrics = chronology_coverage_metrics(
            blocks,
            first.selected_blocks,
            720_000,
            presentation_cap=32,
        )

        self.assertGreaterEqual(first.coverage_ms, 648_000)
        self.assertLessEqual(first.coverage_ms, 792_000)
        self.assertTrue(metrics["first_bucket_covered"])
        self.assertTrue(metrics["last_bucket_covered"])
        selected_ids = {block.block_id for block in first.selected_blocks}
        self.assertTrue(selected_ids & {f"B{index:03d}" for index in range(1, 5)})
        self.assertTrue(selected_ids & {f"B{index:03d}" for index in range(25, 29)})
        self.assertGreaterEqual(
            metrics["selected_last_end_ms"],
            metrics["source_end_ms"]
            - metrics["source_span_ms"] // metrics["timeline_bucket_count"],
        )
        self.assertLessEqual(len(first.sections), 32)
        self.assertEqual(
            [block.ordered_index for block in first.selected_blocks],
            sorted(block.ordered_index for block in first.selected_blocks),
        )
        self.assertEqual(
            [block.block_id for block in first.selected_blocks],
            [block.block_id for block in second.selected_blocks],
        )

    def test_small_frontier_preserves_late_timeline_candidate(self):
        blocks, plan = _long_form_prefix_bias_fixture()

        with patch.object(allocator_module, "MAX_FRONTIER_STATES", 8):
            with self.assertLogs(
                "transflow.ai.internal.allocator", level="WARNING"
            ) as logs:
                result = allocate_blocks(blocks, 720_000, plan, max_sections=32)

        metrics = chronology_coverage_metrics(
            blocks,
            result.selected_blocks,
            720_000,
            presentation_cap=32,
        )
        prune_records = [
            line
            for line in logs.output
            if "NARRATIVE_ALLOCATOR frontier pruned" in line
        ]

        self.assertTrue(prune_records)
        self.assertTrue(metrics["last_bucket_covered"])
        self.assertGreaterEqual(
            metrics["selected_last_end_ms"],
            metrics["source_end_ms"]
            - metrics["source_span_ms"] // metrics["timeline_bucket_count"],
        )
        for record in prune_records:
            self.assertLessEqual(
                int(record.split("frontier_after=", 1)[1].split()[0]),
                8,
            )

    def test_chronology_metrics_report_source_and_selection_endpoints(self):
        blocks = _timeline_blocks()
        metrics = chronology_coverage_metrics(
            blocks,
            [blocks[0], blocks[-1]],
            300_000,
        )

        self.assertEqual(metrics["source_start_ms"], blocks[0].start_ms)
        self.assertEqual(metrics["source_end_ms"], blocks[-1].end_ms)
        self.assertEqual(metrics["selected_first_start_ms"], blocks[0].start_ms)
        self.assertEqual(metrics["selected_last_end_ms"], blocks[-1].end_ms)
        self.assertEqual(metrics["leading_uncovered_ms"], 0)
        self.assertEqual(metrics["trailing_uncovered_ms"], 0)
        self.assertTrue(metrics["first_bucket_covered"])
        self.assertTrue(metrics["last_bucket_covered"])

    def test_essential_section_beats_temporal_spread(self):
        blocks = _blocks([50_000] * 6)
        plan = SemanticPlan(
            sections=[
                SemanticSection(section_id="S001", goal="Opening fact", essential=True),
                SemanticSection(section_id="S002", goal="Supporting context"),
            ],
            block_rankings=[
                BlockRanking(
                    block_id=block.block_id,
                    importance=0.05 if block.ordered_index == 1 else 0.95,
                    section_id="S001" if block.ordered_index == 1 else "S002",
                )
                for block in blocks
            ],
        )

        result = allocate_blocks(blocks, 250_000, plan, max_sections=32)

        self.assertIn("B001", [block.block_id for block in result.selected_blocks])
        self.assertEqual(result.coverage_ms, 250_000)

    def test_essential_sections_are_not_rejected_by_presentation_cap(self):
        blocks = _blocks([10_000, 10_000])
        plan = SemanticPlan(
            sections=[
                SemanticSection(section_id="S001", goal="Opening", essential=True),
                SemanticSection(section_id="S002", goal="Payoff", essential=True),
            ],
            block_rankings=[
                BlockRanking(
                    block_id=block.block_id,
                    importance=0.5,
                    section_id=f"S{index:03d}",
                )
                for index, block in enumerate(blocks, start=1)
            ],
        )

        result = allocate_blocks(blocks, 20_000, plan, max_sections=1)
        self.assertEqual(result.coverage_ms, 20_000)

    def test_incident_shaped_82_block_allocation_is_bounded_and_deterministic(self):
        blocks, plan = _incident_shaped_fixture()

        self.assertEqual(len(blocks), 82)
        self.assertGreater(blocks[-1].end_ms, 300_000)

        with self.assertLogs(
            "transflow.ai.internal.allocator", level="WARNING"
        ) as logs:
            first = allocate_blocks(blocks, 300_000, plan, max_sections=32)
        second = allocate_blocks(blocks, 300_000, plan, max_sections=32)
        essential_section_ids = {
            section.section_id for section in plan.sections if section.essential
        }
        owner_by_block_id = {
            ranking.block_id: ranking.section_id for ranking in plan.block_rankings
        }
        selected_section_ids = {
            owner_by_block_id[block.block_id] for block in first.selected_blocks
        }
        split = split_distant_blocks_into_sections(
            first.sections,
            max_gap_ms=2_000,
            max_sections=32,
        )
        prune_records = [
            line
            for line in logs.output
            if "NARRATIVE_ALLOCATOR frontier pruned" in line
        ]

        self.assertGreaterEqual(first.coverage_ms, 270_000)
        self.assertLessEqual(first.coverage_ms, 330_000)
        self.assertTrue(essential_section_ids.issubset(selected_section_ids))
        self.assertLessEqual(len(split), 32)
        self.assertTrue(prune_records)
        for record in prune_records:
            high_water_mark = int(
                record.split("high_water_mark=", 1)[1].split()[0]
            )
            self.assertLessEqual(
                high_water_mark,
                allocator_module.MAX_FRONTIER_STATES,
            )
        self.assertEqual(
            [block.block_id for block in first.selected_blocks],
            [block.block_id for block in second.selected_blocks],
        )

    def test_frontier_cap_truncates_and_keeps_live_frontier_bounded(self):
        blocks, _ = _incident_shaped_fixture()
        plan = _plan(blocks, [0.5 + (index % 7) / 100 for index in range(len(blocks))])

        with patch.object(allocator_module, "MAX_FRONTIER_STATES", 8):
            with self.assertLogs(
                "transflow.ai.internal.allocator", level="WARNING"
            ) as logs:
                result = allocate_blocks(blocks, 300_000, plan, max_sections=32)

        prune_records = [
            line
            for line in logs.output
            if "NARRATIVE_ALLOCATOR frontier pruned" in line
        ]
        self.assertTrue(prune_records)
        self.assertGreaterEqual(result.coverage_ms, 270_000)
        self.assertLessEqual(result.coverage_ms, 330_000)
        for record in prune_records:
            after = int(record.split("frontier_after=", 1)[1].split()[0])
            before_prune = int(
                record.split("next_frontier_before_prune=", 1)[1].split()[0]
            )
            high_water_mark = int(
                record.split("high_water_mark=", 1)[1].split()[0]
            )
            self.assertLessEqual(after, 8)
            self.assertLessEqual(before_prune, 16)
            self.assertLessEqual(high_water_mark, 8)
            self.assertIn("search_truncated=true", record)

    def test_representability_truncation_fails_open(self):
        blocks = _gapped_blocks(3, duration=10_000, gap=2_000)

        with patch.object(allocator_module, "MAX_REPRESENTABILITY_STATES", 1):
            with self.assertLogs(
                "transflow.ai.internal.allocator", level="WARNING"
            ) as logs:
                representable = source_coverage_target_representable(
                    blocks,
                    25_000,
                    max_sections=1,
                )

        self.assertTrue(representable)
        self.assertTrue(
            any("representability frontier pruned" in line for line in logs.output)
        )


if __name__ == "__main__":
    unittest.main()
