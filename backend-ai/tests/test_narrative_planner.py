"""CT5.7 semantic planning parser tests."""
from __future__ import annotations

import json
import unittest

from app.services.narrative_planning_models import TranscriptBlock
from app.services.planner import PlanningOutputError, parse_semantic_plan


def _blocks() -> list[TranscriptBlock]:
    return [
        TranscriptBlock(
            block_id="B001",
            start_ms=0,
            end_ms=60_000,
            duration_ms=60_000,
            text_preview="Opening",
            ordered_index=1,
            full_text="Opening transcript",
        ),
        TranscriptBlock(
            block_id="B002",
            start_ms=60_000,
            end_ms=120_000,
            duration_ms=60_000,
            text_preview="Middle",
            ordered_index=2,
            full_text="Middle transcript",
        ),
        TranscriptBlock(
            block_id="B003",
            start_ms=120_000,
            end_ms=180_000,
            duration_ms=60_000,
            text_preview="Closing",
            ordered_index=3,
            full_text="Closing transcript",
        ),
    ]


def _payload() -> dict:
    return {
        "title": "Review",
        "sections": [
            {
                "section_id": "S001",
                "title": "Opening",
                "goal": "Establish the premise",
                "preferred_blocks": ["B001"],
                "beat_hint": "HOOK",
            },
            {
                "section_id": "S002",
                "title": "Conclusion",
                "goal": "Deliver the takeaway",
                "preferred_blocks": ["B003"],
                "beat_hint": "PAYOFF",
            },
        ],
        "block_rankings": [
            {"block_id": "B001", "importance": 0.9, "section_id": "S001"},
            {"block_id": "B002", "importance": 0.5, "section_id": "S001"},
            {"block_id": "B003", "importance": 0.8, "section_id": "S002"},
        ],
        "confidence": 0.8,
        "warnings": [],
    }


class SemanticPlanningParserTest(unittest.TestCase):
    def test_parses_complete_source_ordered_plan(self):
        plan = parse_semantic_plan(json.dumps(_payload()), _blocks(), max_sections=3)

        self.assertEqual([section.section_id for section in plan.sections], ["S001", "S002"])
        self.assertEqual(
            [ranking.block_id for ranking in plan.block_rankings],
            ["B001", "B002", "B003"],
        )

    def test_normalizes_semantic_beat_hint(self):
        payload = _payload()
        payload["sections"][0]["beat_hint"] = " rising action "
        payload["sections"][1]["beat_hint"] = "CLIMAX START"

        plan = parse_semantic_plan(json.dumps(payload), _blocks(), max_sections=3)

        self.assertEqual("RISING_ACTION", plan.sections[0].beat_hint)
        self.assertEqual("CLIMAX", plan.sections[1].beat_hint)

    def test_unknown_semantic_beat_hint_falls_back_to_null(self):
        payload = _payload()
        payload["sections"][0]["beat_hint"] = "QUIET CHARACTER MOMENT"

        plan = parse_semantic_plan(json.dumps(payload), _blocks(), max_sections=3)

        self.assertIsNone(plan.sections[0].beat_hint)

    def test_non_text_semantic_beat_hint_remains_a_validation_error(self):
        payload = _payload()
        payload["sections"][0]["beat_hint"] = 123

        with self.assertRaisesRegex(PlanningOutputError, "Malformed semantic planning output"):
            parse_semantic_plan(json.dumps(payload), _blocks(), max_sections=3)

    def test_rejects_malformed_json(self):
        with self.assertRaisesRegex(PlanningOutputError, "Malformed semantic planning output"):
            parse_semantic_plan("not-json", _blocks(), max_sections=3)

    def test_rejects_unknown_fields(self):
        payload = _payload()
        payload["source_refs"] = [{"start_ms": 0, "end_ms": 60_000}]

        with self.assertRaisesRegex(PlanningOutputError, "Malformed semantic planning output"):
            parse_semantic_plan(json.dumps(payload), _blocks(), max_sections=3)

    def test_rejects_legacy_final_plans_envelope(self):
        with self.assertRaisesRegex(PlanningOutputError, "Malformed semantic planning output"):
            parse_semantic_plan('{"plans":[{}]}', _blocks(), max_sections=3)

    def test_rejects_incomplete_block_ranking(self):
        payload = _payload()
        payload["block_rankings"].pop()

        with self.assertRaisesRegex(PlanningOutputError, "cover every block exactly once"):
            parse_semantic_plan(json.dumps(payload), _blocks(), max_sections=3)

    def test_rejects_unknown_block(self):
        payload = _payload()
        payload["block_rankings"][-1]["block_id"] = "B999"

        with self.assertRaisesRegex(PlanningOutputError, r"unknown=\['B999'\]"):
            parse_semantic_plan(json.dumps(payload), _blocks(), max_sections=3)

    def test_rejects_section_ownership_that_moves_backwards(self):
        payload = _payload()
        payload["block_rankings"][1]["section_id"] = "S002"
        payload["block_rankings"][2]["section_id"] = "S001"
        payload["sections"][1]["preferred_blocks"] = []

        with self.assertRaisesRegex(PlanningOutputError, "preserve transcript order"):
            parse_semantic_plan(json.dumps(payload), _blocks(), max_sections=3)

    def test_rejects_more_than_max_sections(self):
        payload = _payload()
        payload["sections"].append(
            {"section_id": "S003", "goal": "Extra", "preferred_blocks": []}
        )

        with self.assertRaisesRegex(PlanningOutputError, "max_sections is 2"):
            parse_semantic_plan(json.dumps(payload), _blocks(), max_sections=2)


if __name__ == "__main__":
    unittest.main()
