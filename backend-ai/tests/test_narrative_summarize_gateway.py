"""CT5.7 staged NARRATIVE_REVIEW gateway tests."""
from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from app.schemas.contract import (
    NarrativeIntentSlice,
    NarrativeSummarizeRequest,
    ProviderPayload,
    SttSegment,
    Usage,
)
from app.services import narrative_summarize_gateway
from app.services.allocator import allocate_blocks, source_coverage_target_representable
from app.services.narrative_planning_models import (
    BlockRanking,
    NarrativeDraft,
    SemanticPlan,
    SemanticSection,
    WrittenSection,
)
from app.services.protocol.types import ChatResult
from app.services.provider_errors import ProviderErrorCode, ProviderException
from app.services.timing_boundaries import SILENCE_BOUNDARY_MS


def _request(provider: ProviderPayload | None = None) -> NarrativeSummarizeRequest:
    if provider is None:
        provider = ProviderPayload(
            protocol="openai_compatible",
            base_url="https://provider.test/v1",
            api_key="sk-real-key",
            model="gpt-4o-mini",
        )
    return NarrativeSummarizeRequest(
        correlation_id="corr-narrative-1",
        media_job_id="job-narrative-1",
        transcript=[
            SttSegment(text="Opening premise", start_ms=0, end_ms=60_000),
            SttSegment(text="Main idea", start_ms=60_000, end_ms=120_000),
            SttSegment(text="Closing takeaway", start_ms=120_000, end_ms=180_000),
        ],
        language="en",
        duration_ms=180_000,
        intent=NarrativeIntentSlice(
            goal_type="SUMMARIZE_GENERATIVE",
            tone_style_hints="concise",
            target_langs=["vi"],
        ),
        constraints=["cover the key takeaway"],
        max_sections=5,
        target_duration_ms=120_000,
        provider=provider,
        content_brief="The video moves from premise to evidence and conclusion.",
    )


def _usage(input_tokens: int = 42, output_tokens: int = 128) -> Usage:
    return Usage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        provider="openai_compatible",
        model="gpt-4o-mini",
    )


def _chat_result(
    text: str,
    *,
    input_tokens: int = 42,
    output_tokens: int = 128,
    finish_reason: str = "stop",
) -> ChatResult:
    return ChatResult(
        text=text,
        usage=_usage(input_tokens, output_tokens),
        finish_reason=finish_reason,
    )


def _semantic_payload(scores: tuple[float, float, float] = (0.9, 0.8, 0.1)) -> dict:
    return {
        "title": "Product review",
        "sections": [
            {
                "section_id": "S001",
                "title": "Hook",
                "goal": "Establish the premise",
                "preferred_blocks": ["B001"],
                "beat_hint": "HOOK",
            },
            {
                "section_id": "S002",
                "title": "Takeaway",
                "goal": "Explain the main conclusion",
                "preferred_blocks": ["B002"],
                "beat_hint": "PAYOFF",
            },
        ],
        "block_rankings": [
            {"block_id": "B001", "importance": scores[0], "section_id": "S001"},
            {"block_id": "B002", "importance": scores[1], "section_id": "S002"},
            {"block_id": "B003", "importance": scores[2], "section_id": "S002"},
        ],
        "reasoning_note": "Source-grounded structure",
        "confidence": 0.8,
        "warnings": [],
    }


def _writer_payload() -> dict:
    return {
        "title": "Product review",
        "sections": [
            {
                "section_id": "S001",
                "heading": "Hook",
                "script_source_lang": " ".join(
                    f"Opening detail {index} grounds the premise in the selected footage."
                    for index in range(13)
                ),
                "beat_type": "HOOK",
                "notes": None,
            },
            {
                "section_id": "S002",
                "heading": "Takeaway",
                "script_source_lang": " ".join(
                    f"Takeaway detail {index} connects the conflict to the final conclusion."
                    for index in range(13)
                ),
                "beat_type": "PAYOFF",
                "notes": None,
            },
        ],
        "global_reasoning_note": "Narration follows the locked footage.",
        "confidence": 0.9,
        "warnings": [],
    }


def _numbered_script(prefix: str, minimum_chars: int) -> str:
    sentences: list[str] = []
    index = 0
    while len(" ".join(sentences)) < minimum_chars:
        sentences.append(
            f"{prefix} detail {index} keeps the selected source beat grounded."
        )
        index += 1
    return " ".join(sentences)


def _quantized_pause_transcript() -> list[dict[str, int | str]]:
    segments: list[dict[str, int | str]] = []
    gaps = (1_520, 1_600, 1_680, 1_760)
    cursor = 0
    for index in range(40):
        start_ms = cursor
        end_ms = start_ms + 8_000
        segments.append(
            {
                "text": f"Segment {index}",
                "start_ms": start_ms,
                "end_ms": end_ms,
            }
        )
        cursor = end_ms + gaps[index % len(gaps)]
    return segments


class TranscriptBlockBoundaryTest(unittest.TestCase):
    def test_quantized_vad_pauses_are_grouped_before_section_cap_is_applied(self):
        blocks = narrative_summarize_gateway._build_transcript_blocks(
            _quantized_pause_transcript()
        )

        self.assertLess(len(blocks), 20)
        self.assertTrue(all(block.duration_ms >= 30_000 for block in blocks))
        self.assertEqual(sum(block.duration_ms for block in blocks), 372_480)
        self.assertTrue(
            source_coverage_target_representable(
                blocks,
                300_000,
                max_sections=12,
            )
        )

    def test_two_second_gap_is_the_exact_presentation_boundary(self):
        def transcript(gap_ms: int) -> list[dict[str, int | str]]:
            return [
                {"text": "first", "start_ms": 0, "end_ms": 16_000},
                {
                    "text": "second",
                    "start_ms": 16_000 + gap_ms,
                    "end_ms": 32_000 + gap_ms,
                },
            ]

        natural = narrative_summarize_gateway._build_transcript_blocks(
            transcript(SILENCE_BOUNDARY_MS - 1)
        )
        boundary = narrative_summarize_gateway._build_transcript_blocks(
            transcript(SILENCE_BOUNDARY_MS)
        )

        self.assertEqual(len(natural), 1)
        self.assertEqual(len(boundary), 2)


class PacingPreflightTest(unittest.TestCase):
    def test_sixty_five_percent_source_estimate_requires_repair_for_five_minutes(self):
        draft = NarrativeDraft(
            sections=[
                WrittenSection(
                    section_id="S001",
                    script_source_lang="x" * 2_730,
                )
            ]
        )
        diagnostics = narrative_summarize_gateway._narration_pacing_diagnostics(
            draft,
            [{"section_id": "S001", "target_chars": 4_200}],
        )

        self.assertEqual(diagnostics[0]["ratio"], 0.65)
        self.assertEqual(diagnostics[0]["pacing_status"], "UNDERFILL")
        self.assertTrue(diagnostics[0]["estimate_only"])
        self.assertEqual(diagnostics[0]["duration_authority"], "TTS")
        self.assertTrue(narrative_summarize_gateway._pacing_needs_repair(diagnostics))
        self.assertEqual(
            narrative_summarize_gateway._pacing_repair_feedback(diagnostics)[0]["deficit_chars"],
            1_470,
        )

    def test_overlong_source_estimate_requires_trim_repair(self):
        draft = NarrativeDraft(
            sections=[
                WrittenSection(
                    section_id="S001",
                    script_source_lang="x" * 1_050,
                )
            ]
        )
        diagnostics = narrative_summarize_gateway._narration_pacing_diagnostics(
            draft,
            [{"section_id": "S001", "target_chars": 840}],
        )

        self.assertEqual(diagnostics[0]["pacing_status"], "OVERFILL")
        self.assertEqual(diagnostics[0]["overage_chars"], 210)
        self.assertTrue(narrative_summarize_gateway._pacing_needs_repair(diagnostics))
        self.assertEqual(
            narrative_summarize_gateway._pacing_repair_feedback(diagnostics)[0]["overage_chars"],
            210,
        )

class MockModeTest(unittest.IsolatedAsyncioTestCase):
    async def test_mock_mode_returns_one_deterministic_plan(self):
        with patch.object(narrative_summarize_gateway.settings, "mock_mode", True):
            first = await narrative_summarize_gateway.summarize_narrative(_request())
            second = await narrative_summarize_gateway.summarize_narrative(_request())

        self.assertEqual(first.status, "COMPLETED")
        self.assertEqual(len(first.plans), 1)
        self.assertEqual(first.model_dump(), second.model_dump())
        refs = [
            (ref.start_ms, ref.end_ms)
            for section in first.plans[0].sections
            for ref in section.source_refs
        ]
        self.assertEqual(refs, [(0, 60_000), (60_000, 120_000)])


class StagedGatewayTest(unittest.IsolatedAsyncioTestCase):
    async def _run(
        self,
        provider: ProviderPayload | None = None,
        side_effect=None,
        request: NarrativeSummarizeRequest | None = None,
    ):
        if side_effect is None:
            side_effect = [
                _chat_result(json.dumps(_semantic_payload()), input_tokens=10, output_tokens=20),
                _chat_result(json.dumps(_writer_payload()), input_tokens=30, output_tokens=40),
            ]
        chat_mock = AsyncMock(side_effect=side_effect)
        with patch.object(narrative_summarize_gateway.settings, "mock_mode", False), patch.object(
            narrative_summarize_gateway, "chat", chat_mock
        ):
            response = await narrative_summarize_gateway.summarize_narrative(
                request or _request(provider)
            )
        return response, chat_mock

    async def test_short_writer_is_repaired_before_narrative_completion(self):
        short = _writer_payload()
        short_script = " ".join(
            f"Short detail {index} keeps the selected beat grounded in context."
            for index in range(7)
        )
        for section in short["sections"]:
            section["script_source_lang"] = short_script

        repaired = _writer_payload()
        response, chat_mock = await self._run(
            side_effect=[
                _chat_result(json.dumps(_semantic_payload()), input_tokens=10, output_tokens=20),
                _chat_result(json.dumps(short), input_tokens=11, output_tokens=21),
                _chat_result(json.dumps(repaired), input_tokens=12, output_tokens=22),
            ]
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 3)
        repair_call = chat_mock.await_args_list[2]
        self.assertIn("NARRATIVE", repair_call.args[1].upper())
        self.assertIn("target_chars", repair_call.args[2])
        self.assertIn("deficit_chars", repair_call.args[2])
        self.assertIn("section_id=\"S001\"", repair_call.args[2])
        self.assertEqual(
            [section.seq for section in response.plans[0].sections],
            [1, 2],
        )
        self.assertEqual(
            response.plans[0].sections[0].script_source_lang,
            repaired["sections"][0]["script_source_lang"],
        )

    async def test_overlong_writer_is_repaired_before_narrative_completion(self):
        overlong = _writer_payload()
        overlong_script = " ".join(
            f"Overlong detail {index} expands the selected beat beyond the pacing estimate."
            for index in range(20)
        )
        for section in overlong["sections"]:
            section["script_source_lang"] = overlong_script

        response, chat_mock = await self._run(
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(overlong)),
                _chat_result(json.dumps(_writer_payload())),
            ]
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 3)
        repair_prompt = chat_mock.await_args_list[2].args[2]
        self.assertIn("overage_chars", repair_prompt)
        self.assertIn("trim approximately", repair_prompt)

    async def test_pacing_repair_restores_sections_that_did_not_need_repair(self):
        draft = _writer_payload()
        original_s1 = draft["sections"][0]["script_source_lang"]
        draft["sections"][1]["script_source_lang"] = "Too short."

        repaired = _writer_payload()
        repaired["sections"][0] = {
            "section_id": "S001",
            "unexpected": "Malformed stable section must be ignored",
        }

        response, chat_mock = await self._run(
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(draft)),
                _chat_result(json.dumps(repaired)),
            ]
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 3)
        sections = response.plans[0].sections
        self.assertEqual(sections[0].script_source_lang, original_s1)
        self.assertEqual(
            sections[1].script_source_lang,
            repaired["sections"][1]["script_source_lang"],
        )
        repair_prompt = chat_mock.await_args_list[2].args[2]
        pacing_block = repair_prompt.split("<pacing_repair>", 1)[1].split(
            "</pacing_repair>", 1
        )[0]
        self.assertIn('section_id="S002"', pacing_block)
        self.assertNotIn('section_id="S001"', pacing_block)

    async def test_residual_underfill_after_one_repair_is_warning_only(self):
        short = _writer_payload()
        short["sections"][0]["script_source_lang"] = (
            "Still too short for the opening premise."
        )
        short["sections"][1]["script_source_lang"] = (
            "Still too short for the closing takeaway."
        )

        response, chat_mock = await self._run(
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(short)),
                _chat_result(json.dumps(short)),
            ]
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 3)
        self.assertIsNone(response.error)
        self.assertTrue(
            any(
                warning.startswith("NARRATION_PACING_ESTIMATE_RESIDUAL:")
                for warning in response.plans[0].warnings
            )
        )

    async def test_residual_overfill_after_bounded_repair_is_warning_only(self):
        overlong = _writer_payload()
        for index, section in enumerate(overlong["sections"]):
            section["script_source_lang"] = _numbered_script(
                f"Initial section {index}",
                1_200,
            )
        repaired = _writer_payload()
        for index, section in enumerate(repaired["sections"]):
            section["script_source_lang"] = _numbered_script(
                f"Repaired section {index}",
                900,
            )

        with patch.object(
            narrative_summarize_gateway,
            "narration_target_chars",
            return_value=800,
        ):
            response, chat_mock = await self._run(
                side_effect=[
                    _chat_result(json.dumps(_semantic_payload())),
                    _chat_result(json.dumps(overlong)),
                    _chat_result(json.dumps(repaired)),
                ]
            )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 3)
        self.assertIsNone(response.error)
        self.assertEqual(
            response.plans[0].sections[0].script_source_lang,
            repaired["sections"][0]["script_source_lang"],
        )
        self.assertTrue(
            any(
                warning.startswith("NARRATION_PACING_ESTIMATE_RESIDUAL:")
                for warning in response.plans[0].warnings
            )
        )

    async def test_tiny_section_estimate_residual_does_not_fail_valid_narration(self):
        tiny = _writer_payload()
        tiny["sections"][0]["script_source_lang"] = (
            "The opening scene establishes the premise with a grounded detail."
        )
        tiny["sections"][1]["script_source_lang"] = (
            "The next scene develops the conclusion with a grounded detail."
        )

        with patch.object(
            narrative_summarize_gateway,
            "narration_target_chars",
            return_value=50,
        ):
            response, chat_mock = await self._run(
                side_effect=[
                    _chat_result(json.dumps(_semantic_payload())),
                    _chat_result(json.dumps(tiny)),
                    _chat_result(json.dumps(tiny)),
                ]
            )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 3)
        self.assertIsNone(response.error)
        self.assertTrue(
            any(
                warning.startswith("NARRATION_PACING_ESTIMATE_RESIDUAL:")
                for warning in response.plans[0].warnings
            )
        )

    async def test_planning_allocation_writing_builds_runtime_owned_source_refs(self):
        response, chat_mock = await self._run()

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 2)
        plan = response.plans[0]
        self.assertEqual(plan.target_duration_ms, 120_000)
        self.assertEqual(
            [
                (ref.start_ms, ref.end_ms)
                for section in plan.sections
                for ref in section.source_refs
            ],
            [(0, 60_000), (60_000, 120_000)],
        )
        self.assertEqual(response.usage.input_tokens, 40)
        self.assertEqual(response.usage.output_tokens, 60)

        planning_call, writer_call = chat_mock.await_args_list
        self.assertIn("SEMANTIC", planning_call.args[1].upper())
        self.assertIn("Opening premise", planning_call.args[2])
        self.assertNotIn("start_ms", planning_call.args[2])
        self.assertNotIn("source_refs", planning_call.args[2])
        self.assertIn("Opening premise", writer_call.args[2])
        self.assertIn("Main idea", writer_call.args[2])
        self.assertNotIn("Closing takeaway", writer_call.args[2])
        self.assertNotIn("start_ms", writer_call.args[2])
        self.assertNotIn("source_refs", writer_call.args[2])

    async def test_provider_identity_does_not_change_allocation(self):
        openai_response, _ = await self._run()
        anthropic = ProviderPayload(
            protocol="anthropic",
            base_url="https://api.anthropic.com/v1",
            api_key="sk-real-key",
            model="claude-test",
        )
        anthropic_response, _ = await self._run(anthropic)

        openai_refs = [
            (ref.start_ms, ref.end_ms)
            for section in openai_response.plans[0].sections
            for ref in section.source_refs
        ]
        anthropic_refs = [
            (ref.start_ms, ref.end_ms)
            for section in anthropic_response.plans[0].sections
            for ref in section.source_refs
        ]
        self.assertEqual(openai_refs, anthropic_refs)

    async def test_impossible_allocation_fails_before_writer_call(self):
        req = _request()
        req.target_duration_ms = 20_000
        chat_mock = AsyncMock(return_value=_chat_result(json.dumps(_semantic_payload())))
        with patch.object(narrative_summarize_gateway.settings, "mock_mode", False), patch.object(
            narrative_summarize_gateway, "chat", chat_mock
        ):
            response = await narrative_summarize_gateway.summarize_narrative(req)

        self.assertEqual(response.status, "FAILED")
        self.assertIn("source_coverage_target_not_representable", response.error)
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION.value,
        )
        self.assertFalse(response.error_detail.retryable)
        self.assertEqual(chat_mock.await_count, 0)

    async def test_malformed_planning_output_fails_before_writer_call(self):
        response, chat_mock = await self._run(side_effect=[_chat_result("not-json")])

        self.assertEqual(response.status, "FAILED")
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED.value,
        )
        self.assertEqual(chat_mock.await_count, 1)

    async def test_writer_cannot_return_source_refs(self):
        writer = _writer_payload()
        writer["sections"][0]["source_refs"] = [{"start_ms": 0, "end_ms": 60_000}]
        response, chat_mock = await self._run(
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(writer)),
            ]
        )

        self.assertEqual(response.status, "FAILED")
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED.value,
        )
        self.assertEqual(chat_mock.await_count, 2)

    async def test_finish_reason_length_fails_before_stage_output_is_parsed(self):
        response, chat_mock = await self._run(
            side_effect=[_chat_result('{"sections":', finish_reason="length")]
        )

        self.assertEqual(response.status, "FAILED")
        self.assertIn("Provider response truncated during SEMANTIC_PLANNING", response.error)
        self.assertEqual(chat_mock.await_count, 1)

    async def test_both_stages_use_safe_output_budget_and_json_mode(self):
        response, chat_mock = await self._run()

        self.assertEqual(response.status, "COMPLETED")
        for call in chat_mock.await_args_list:
            self.assertEqual(call.kwargs["max_tokens"], 8_192)
            self.assertEqual(call.kwargs["response_format"], {"type": "json_object"})

    async def test_anthropic_omits_openai_json_mode_for_both_stages(self):
        provider = ProviderPayload(
            protocol="anthropic",
            base_url="https://api.anthropic.com/v1",
            api_key="sk-real-key",
            model="claude-test",
        )
        response, chat_mock = await self._run(provider)

        self.assertEqual(response.status, "COMPLETED")
        self.assertTrue(all(call.kwargs["response_format"] is None for call in chat_mock.await_args_list))

    async def test_json_mode_fallback_is_scoped_to_rejected_stage(self):
        unsupported = ProviderException(
            ProviderErrorCode.PROVIDER_BAD_REQUEST,
            "Provider rejected chat (400): unknown response_format parameter",
        )
        response, chat_mock = await self._run(
            side_effect=[
                unsupported,
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(_writer_payload())),
            ]
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 3)
        self.assertEqual(chat_mock.await_args_list[0].kwargs["response_format"], {"type": "json_object"})
        self.assertIsNone(chat_mock.await_args_list[1].kwargs["response_format"])
        self.assertEqual(chat_mock.await_args_list[2].kwargs["response_format"], {"type": "json_object"})

    async def test_unrelated_bad_request_does_not_disable_json_mode(self):
        unrelated = ProviderException(
            ProviderErrorCode.PROVIDER_BAD_REQUEST,
            "Provider rejected chat (400): invalid max_tokens parameter",
        )
        response, chat_mock = await self._run(side_effect=unrelated)

        self.assertEqual(response.status, "FAILED")
        self.assertEqual(chat_mock.await_count, 1)
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_BAD_REQUEST.value,
        )

    async def test_overlap_asr_does_not_fail_after_semantic_planning(self):
        req = _request()
        req.transcript = [
            SttSegment(text="First idea", start_ms=0, end_ms=50_000),
            SttSegment(text="Overlapping idea", start_ms=49_000, end_ms=100_000),
            SttSegment(text="Supporting detail", start_ms=100_000, end_ms=150_000),
            SttSegment(text="Closing detail", start_ms=150_000, end_ms=200_000),
        ]
        req.duration_ms = 200_000
        req.target_duration_ms = 150_000
        writer = _writer_payload()
        writer["sections"][0]["script_source_lang"] = " ".join(
            f"Opening detail {index} grounds the premise in the selected footage."
            for index in range(24)
        )
        writer["sections"][1]["script_source_lang"] = " ".join(
            f"Takeaway detail {index} connects the conflict to the final conclusion."
            for index in range(11)
        )

        response, chat_mock = await self._run(
            request=req,
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(writer)),
            ],
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 2)


class PromptBoundaryTest(unittest.TestCase):
    def test_semantic_prompt_excludes_duration_arithmetic_and_writer_fields(self):
        blocks = narrative_summarize_gateway._build_transcript_blocks(
            [
                {"text": "Opening", "start_ms": 0, "end_ms": 60_000},
                {"text": "Closing", "start_ms": 60_000, "end_ms": 120_000},
            ]
        )
        from app.core.prompts import build_narrative_semantic_plan_prompt

        system, user = build_narrative_semantic_plan_prompt(
            [block.model_dump() for block in blocks],
            language="en",
            intent={"goal_type": "SUMMARIZE_GENERATIVE"},
            constraints=[],
            max_sections=3,
        )

        self.assertIn("rank every block", system.lower())
        self.assertIn("soft semantic preferences", user.lower())
        self.assertIn('block_id="B001"', user)
        self.assertNotIn("target_duration_ms", user)
        self.assertNotIn("source_refs", user)
        self.assertNotIn("merged", user.lower())
        self.assertNotIn("script_source_lang", user)

    def test_canonical_blocks_use_existing_segment_boundaries(self):
        transcript = [
            {"text": "opening", "start_ms": 0, "end_ms": 35_000},
            {"text": "detail", "start_ms": 35_000, "end_ms": 62_000},
            {"text": "middle", "start_ms": 62_000, "end_ms": 118_000},
            {"text": "closing", "start_ms": 118_000, "end_ms": 176_000},
        ]
        blocks = narrative_summarize_gateway._build_transcript_blocks(transcript)

        self.assertEqual([block.block_id for block in blocks], ["B001", "B002", "B003"])
        starts = {segment["start_ms"] for segment in transcript}
        ends = {segment["end_ms"] for segment in transcript}
        for index, block in enumerate(blocks, start=1):
            self.assertEqual(block.ordered_index, index)
            self.assertIn(block.start_ms, starts)
            self.assertIn(block.end_ms, ends)
            self.assertEqual(block.duration_ms, block.end_ms - block.start_ms)

    def test_overlap_connected_segments_keep_source_ranges_and_allocate(self):
        transcript = [
            {"text": "first", "start_ms": 0, "end_ms": 50_000},
            {"text": "overlap", "start_ms": 49_000, "end_ms": 100_000},
            {"text": "third", "start_ms": 100_000, "end_ms": 150_000},
            {"text": "fourth", "start_ms": 150_000, "end_ms": 200_000},
        ]
        blocks = narrative_summarize_gateway._build_transcript_blocks(transcript)

        self.assertEqual(
            [(block.start_ms, block.end_ms) for block in blocks],
            [(0, 100_000), (100_000, 150_000), (150_000, 200_000)],
        )
        self.assertEqual(
            [block.ordered_index for block in blocks],
            list(range(1, len(blocks) + 1)),
        )
        self.assertTrue(
            all(left.end_ms <= right.start_ms for left, right in zip(blocks, blocks[1:]))
        )
        self.assertEqual(
            [
                (segment.text, segment.start_ms, segment.end_ms)
                for block in blocks
                for segment in block.segments
            ],
            [(item["text"], item["start_ms"], item["end_ms"]) for item in transcript],
        )

        plan = SemanticPlan(
            sections=[SemanticSection(section_id="S001", goal="Cover the transcript")],
            block_rankings=[
                BlockRanking(block_id=block.block_id, importance=0.5, section_id="S001")
                for block in blocks
            ],
        )
        allocation = allocate_blocks(blocks, 150_000, plan)
        self.assertEqual(allocation.coverage_ms, 150_000)

    def test_oversized_atomic_segment_is_not_split_or_text_duplicated(self):
        transcript = [{"text": "one atomic spoken event", "start_ms": 0, "end_ms": 100_000}]

        blocks = narrative_summarize_gateway._build_transcript_blocks(transcript)

        self.assertEqual(len(blocks), 1)
        self.assertEqual(
            (blocks[0].start_ms, blocks[0].end_ms),
            (0, 100_000),
        )
        self.assertEqual(blocks[0].full_text, "one atomic spoken event")
        self.assertEqual(len(blocks[0].segments), 1)
        self.assertEqual(
            (
                blocks[0].segments[0].text,
                blocks[0].segments[0].start_ms,
                blocks[0].segments[0].end_ms,
            ),
            ("one atomic spoken event", 0, 100_000),
        )

    def test_nested_overlap_uses_maximum_coverage_end(self):
        transcript = [
            {"text": "outer", "start_ms": 0, "end_ms": 60_000},
            {"text": "nested", "start_ms": 30_000, "end_ms": 50_000},
            {"text": "next", "start_ms": 60_000, "end_ms": 120_000},
        ]

        blocks = narrative_summarize_gateway._build_transcript_blocks(transcript)

        self.assertEqual(
            [(block.start_ms, block.end_ms) for block in blocks],
            [(0, 60_000), (60_000, 120_000)],
        )
        self.assertEqual(
            [(segment.start_ms, segment.end_ms) for segment in blocks[0].segments],
            [(0, 60_000), (30_000, 50_000)],
        )


if __name__ == "__main__":
    unittest.main()
