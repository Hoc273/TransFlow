"""CT5.7 locked-footage writer tests."""
from __future__ import annotations

import json
import unittest

from app.core.prompts import (
    build_narrative_multimodal_writer_prompt,
    build_narrative_writer_prompt,
)
from app.services.narrative_summarize_gateway import _safe_prompt_preview
from app.services.planner import (
    PlanningOutputError,
    parse_narrative_draft,
    parse_narrative_repair,
)


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
    def test_both_writers_use_declared_source_language_for_script(self):
        for builder, extra in (
            (build_narrative_writer_prompt, {}),
            (build_narrative_multimodal_writer_prompt, {"multimodal_context": {}}),
        ):
            system, user = builder(
                _allocated_sections(),
                language="zh",
                intent={"goal_type": "SUMMARIZE_GENERATIVE", "target_langs": ["vi"]},
                constraints=[],
                content_brief="A product review.",
                **extra,
            )

            self.assertIn("source language declared by <language>", system)
            self.assertIn("script_source_lang field", system)
            self.assertIn("target_langs are downstream translation destinations", system)
            self.assertIn("unless that material is in the declared source language", system)
            self.assertNotIn("target narration language", system)
            self.assertIn("<language>zh</language>", user)
            self.assertIn('"script_source_lang"', user)

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

    def test_writer_accepts_null_beat_type_note_without_persisting_it(self):
        payload = _draft()
        payload["sections"][0]["beat_type_note"] = None

        draft = parse_narrative_draft(json.dumps(payload), ["S001"])

        self.assertNotIn("beat_type_note", draft.sections[0].model_dump())

    def test_pacing_repair_accepts_null_beat_type_note_without_persisting_it(self):
        payload = {"sections": [{**_draft()["sections"][0], "beat_type_note": None}]}

        repaired = parse_narrative_repair(json.dumps(payload), ["S001"])

        self.assertNotIn("beat_type_note", repaired["S001"].model_dump())

    def test_non_null_beat_type_note_remains_forbidden(self):
        payload = _draft()
        payload["sections"][0]["beat_type_note"] = "provider commentary"

        with self.assertRaisesRegex(PlanningOutputError, "Malformed narrative writing output"):
            parse_narrative_draft(json.dumps(payload), ["S001"])

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

    def test_writer_prompt_discourages_provider_added_helper_fields(self):
        system, _ = build_narrative_writer_prompt(
            _allocated_sections(),
            language="en",
            intent={"goal_type": "SUMMARIZE_GENERATIVE", "target_langs": ["vi"]},
            constraints=[],
            content_brief="A product review.",
        )

        self.assertIn("Use only the keys defined by the current <output_format>", system)
        self.assertIn("beat_type_note", system)

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

    def test_duplicate_feedback_is_grounded_and_limited_to_reported_sections(self):
        sections = _allocated_sections()
        sections.append({
            **_allocated_sections()[0],
            "section_id": "S002",
            "title": "Closing",
            "goal": "State the takeaway",
        })
        feedback = [{
            "section_id": "S002",
            "duplicate_kind": "EXACT_SENTENCE",
            "duplicate_sentence": "This repeated sentence must be rewritten with grounded detail.",
            "current_script": "This repeated sentence must be rewritten with grounded detail. More context.",
            "target_chars": 840,
        }]

        for builder, extra in (
            (build_narrative_writer_prompt, {}),
            (build_narrative_multimodal_writer_prompt, {"multimodal_context": {}}),
        ):
            system, user = builder(
                sections,
                language="en",
                intent={"goal_type": "SUMMARIZE_GENERATIVE", "target_langs": ["vi"]},
                constraints=[],
                content_brief="A product review.",
                duplicate_feedback=feedback,
                **extra,
            )

            duplicate_block = user.split("<duplicate_repair>", 1)[1].split(
                "</duplicate_repair>", 1
            )[0]
            self.assertIn("Never duplicate an entire section", system)
            self.assertIn("at most twice", system)
            self.assertIn('section_id="S002"', duplicate_block)
            self.assertNotIn('section_id="S001"', duplicate_block)
            self.assertIn("source grounding", duplicate_block)
            self.assertIn('target_chars="840"', duplicate_block)
            self.assertIn("do not make narration shorter", duplicate_block)

    def test_duplicate_sentence_and_current_script_are_redacted_from_prompt_preview(self):
        preview = _safe_prompt_preview(
            "<duplicate_sentence>Private repeated narration.</duplicate_sentence>"
            "<current_script>Private current script.</current_script>"
            "<verbatim_span>Private copied source wording.</verbatim_span>",
            500,
        )

        self.assertNotIn("Private repeated narration", preview)
        self.assertNotIn("Private current script", preview)
        self.assertNotIn("Private copied source wording", preview)
        self.assertEqual(preview.count("<redacted>"), 3)

    def test_unified_quality_repair_prompt_carries_all_reported_diagnostics(self):
        feedback = [{
            "section_id": "S001",
            "target_chars": 840,
            "run_words": 15,
            "verbatim_span": "a long copied source run",
            "current_script": "Current copied narration.",
            "violation": "SENTENCE_STRUCTURE",
            "message": "Rewrite the copied source wording as a structured recap.",
        }]

        for builder, extra in (
            (build_narrative_writer_prompt, {}),
            (build_narrative_multimodal_writer_prompt, {"multimodal_context": {}}),
        ):
            _, user = builder(
                _allocated_sections(),
                language="vi",
                intent={"goal_type": "SUMMARIZE_GENERATIVE"},
                constraints=[],
                content_brief=None,
                pacing_feedback=[{
                    "section_id": "S001",
                    "target_chars": 840,
                    "actual_chars": 200,
                    "deficit_chars": 640,
                    "ratio": 0.24,
                }],
                duplicate_feedback=[{
                    "section_id": "S001",
                    "duplicate_kind": "WHOLE_SECTION",
                    "current_script": "Repeated narration.",
                }],
                verbatim_feedback=feedback,
                structure_feedback=feedback,
                **extra,
            )

            self.assertIn("<pacing_repair>", user)
            self.assertIn("<duplicate_repair>", user)
            self.assertIn("<source_copy_repair>", user)
            self.assertIn("<narrative_structure_repair>", user)
            self.assertIn('section_id="S001"', user)


if __name__ == "__main__":
    unittest.main()
