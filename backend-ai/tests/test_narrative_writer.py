"""CT5.7 locked-footage writer tests."""
from __future__ import annotations

import json
import unittest

from app.core.prompts import build_narrative_writer_prompt
from app.services.planner import PlanningOutputError, parse_narrative_draft


def _allocated_sections() -> list[dict]:
    return [
        {
            "section_id": "S001",
            "title": "Opening",
            "goal": "Establish the premise",
            "beat_hint": "HOOK",
            "blocks": [
                {
                    "block_id": "B001",
                    "start_ms": 0,
                    "end_ms": 60_000,
                    "duration_ms": 60_000,
                    "ordered_index": 1,
                    "text_preview": "Preview",
                    "full_text": "The full selected transcript text.",
                }
            ],
        }
    ]


def _draft() -> dict:
    return {
        "title": "Review",
        "sections": [
            {
                "section_id": "S001",
                "heading": "Opening",
                "script_source_lang": "A concise source-language opening.",
                "beat_type": "HOOK",
                "notes": None,
            }
        ],
        "confidence": 0.8,
        "warnings": [],
    }


class NarrativeWriterPromptTest(unittest.TestCase):
    def test_writer_receives_full_text_but_no_timestamps_or_source_refs(self):
        system, user = build_narrative_writer_prompt(
            _allocated_sections(),
            language="en",
            intent={"goal_type": "SUMMARIZE_GENERATIVE", "target_langs": ["vi"]},
            constraints=[],
            content_brief="A product review.",
        )

        self.assertIn("selected footage has already been finalized", system)
        self.assertIn("The full selected transcript text.", user)
        self.assertIn('section_id="S001"', user)
        self.assertNotIn("start_ms", user)
        self.assertNotIn("end_ms", user)
        self.assertNotIn("duration_ms", user)
        self.assertNotIn("source_refs", user)

    def test_writer_normalizes_extended_and_synonym_beat_types(self):
        payload = _draft()
        payload["sections"][0]["beat_type"] = "  rising action  "
        draft = parse_narrative_draft(json.dumps(payload), ["S001"])
        self.assertEqual("RISING_ACTION", draft.sections[0].beat_type)

        payload["sections"][0]["beat_type"] = "CLIMAX START"
        draft = parse_narrative_draft(json.dumps(payload), ["S001"])
        self.assertEqual("CLIMAX", draft.sections[0].beat_type)

    def test_writer_unknown_beat_type_falls_back_to_null(self):
        payload = _draft()
        payload["sections"][0]["beat_type"] = "QUIET CHARACTER MOMENT"

        draft = parse_narrative_draft(json.dumps(payload), ["S001"])

        self.assertIsNone(draft.sections[0].beat_type)

    def test_writer_non_text_beat_type_remains_a_validation_error(self):
        payload = _draft()
        payload["sections"][0]["beat_type"] = 123

        with self.assertRaisesRegex(PlanningOutputError, "Malformed narrative writing output"):
            parse_narrative_draft(json.dumps(payload), ["S001"])

    def test_writer_prompt_lists_allowed_beat_types(self):
        system, _ = build_narrative_writer_prompt(
            _allocated_sections(),
            language="en",
            intent={"goal_type": "SUMMARIZE_GENERATIVE", "target_langs": ["vi"]},
            constraints=[],
            content_brief="A product review.",
        )

        self.assertIn("RISING_ACTION", system)
        self.assertIn("TURNING_POINT", system)
        self.assertIn("Do not invent custom beat types", system)

    def test_writer_output_cannot_include_timestamps_or_source_refs(self):
        payload = _draft()
        payload["sections"][0]["source_refs"] = [{"start_ms": 0, "end_ms": 60_000}]

        with self.assertRaisesRegex(PlanningOutputError, "Malformed narrative writing output"):
            parse_narrative_draft(json.dumps(payload), ["S001"])

    def test_writer_must_return_locked_sections_in_order(self):
        payload = _draft()
        payload["sections"].append(
            {
                "section_id": "S002",
                "script_source_lang": "Unexpected extra section.",
            }
        )

        with self.assertRaisesRegex(PlanningOutputError, "allocated sections in order"):
            parse_narrative_draft(json.dumps(payload), ["S001"])

    def test_writer_rejects_blank_script(self):
        payload = _draft()
        payload["sections"][0]["script_source_lang"] = "   "

        with self.assertRaisesRegex(PlanningOutputError, "blank script"):
            parse_narrative_draft(json.dumps(payload), ["S001"])

    def test_writer_receives_pacing_target_when_provided(self):
        sections = _allocated_sections()
        sections[0]["target_chars"] = 840
        _, user = build_narrative_writer_prompt(
            sections,
            language="vi",
            intent={"goal_type": "SUMMARIZE_GENERATIVE", "target_langs": ["vi"]},
            constraints=[],
            content_brief="A fable.",
        )

        self.assertIn('target_chars="840"', user)
        self.assertIn("PACING", user)
        # Still no raw timestamps or source refs for the writer.
        self.assertNotIn("start_ms", user)
        self.assertNotIn("source_refs", user)

    def test_writer_omits_pacing_target_when_absent(self):
        _, user = build_narrative_writer_prompt(
            _allocated_sections(),
            language="en",
            intent={"goal_type": "SUMMARIZE_GENERATIVE", "target_langs": ["vi"]},
            constraints=[],
            content_brief="A product review.",
        )

        self.assertNotIn("target_chars", user)
        self.assertNotIn("PACING", user)


if __name__ == "__main__":
    unittest.main()
