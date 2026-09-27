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
from app.services.allocator import (
    allocate_blocks,
    duration_window,
    source_coverage_target_representable,
)
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


def _duplicate_writer_payload() -> dict:
    payload = _writer_payload()
    payload["sections"][1]["script_source_lang"] = payload["sections"][0]["script_source_lang"]
    return payload


def _same_language_verbatim_request() -> NarrativeSummarizeRequest:
    req = _request()
    req.language = "vi"
    req.transcript = [
        SttSegment(
            text="Nhân vật chính bước vào căn phòng tối và nhìn thấy chiếc hộp cũ nằm dưới ánh đèn",
            start_ms=0,
            end_ms=60_000,
        ),
        SttSegment(
            text="Những dấu hiệu mới làm thay đổi cách mọi người hiểu về câu chuyện",
            start_ms=60_000,
            end_ms=120_000,
        ),
        SttSegment(
            text="Cuối cùng nhóm nhân vật đưa ra lựa chọn và khép lại cuộc hành trình",
            start_ms=120_000,
            end_ms=180_000,
        ),
    ]
    req.duration_ms = 180_000
    req.target_duration_ms = 120_000
    return req


def _verbatim_writer_payload(source_text: str, *, whole_sentence: bool = False) -> dict:
    payload = _writer_payload()
    payload["sections"][0]["script_source_lang"] = (
        source_text
        if whole_sentence
        else source_text
        + " Sau đó nhóm nhân vật cân nhắc kế hoạch mới trước khi rời khỏi căn phòng trong im lặng."
    )
    return payload


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


def _duration_request(
    source_duration_ms: int,
    target_duration_ms: int,
    segment_duration_ms: int = 10_000,
) -> NarrativeSummarizeRequest:
    req = _request()
    segments: list[SttSegment] = []
    cursor = 0
    while cursor < source_duration_ms:
        end = min(source_duration_ms, cursor + segment_duration_ms)
        segments.append(
            SttSegment(
                text=f"Timed source segment {len(segments) + 1}",
                start_ms=cursor,
                end_ms=end,
            )
        )
        cursor = end
    req.transcript = segments
    req.duration_ms = source_duration_ms
    req.target_duration_ms = target_duration_ms
    req.max_sections = None
    return req


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

    def test_shorter_source_pacing_uses_selected_coverage_not_requested_target(self):
        req = _duration_request(40_000, 60_000)
        effective_target = narrative_summarize_gateway._effective_narration_target_ms(
            req, 40_000
        )

        pacing = narrative_summarize_gateway._narration_pacing_targets(
            [{"section_id": "S001", "blocks": []}],
            {"S001": [(0, 40_000)]},
            target_duration_ms=effective_target,
        )

        self.assertEqual(effective_target, 40_000)
        self.assertEqual(pacing[0]["narration_target_ms"], 40_000)
        self.assertEqual(pacing[0]["total_presentation_span_ms"], 40_000)
        self.assertTrue(pacing[0]["normalized_to_requested"])

class DuplicateNarrationDiagnosticTest(unittest.TestCase):
    def test_sentence_diagnostic_targets_only_the_third_occurrence(self):
        repeated = "The grounded takeaway remains visible in this section."
        draft = NarrativeDraft(
            sections=[
                WrittenSection(
                    section_id=f"S00{index}",
                    script_source_lang=f"{repeated} Unique detail for section {index}.",
                )
                for index in range(1, 4)
            ]
        )

        diagnostics = narrative_summarize_gateway._narrative_duplicate_diagnostics(
            draft,
            [
                {"section_id": f"S00{index}", "target_chars": 100}
                for index in range(1, 4)
            ],
        )

        self.assertEqual([item["section_id"] for item in diagnostics], ["S003"])
        self.assertEqual(diagnostics[0]["duplicate_kind"], "EXACT_SENTENCE")
        self.assertEqual(diagnostics[0]["duplicate_sentence"], repeated)

    def test_whole_section_diagnostic_targets_the_later_section(self):
        script = "A grounded section-specific sentence explains the selected event."
        draft = NarrativeDraft(
            sections=[
                WrittenSection(section_id="S001", script_source_lang=script),
                WrittenSection(section_id="S002", script_source_lang=script),
            ]
        )

        diagnostics = narrative_summarize_gateway._narrative_duplicate_diagnostics(
            draft,
            [
                {"section_id": "S001", "target_chars": 100},
                {"section_id": "S002", "target_chars": 100},
            ],
        )

        self.assertEqual([item["section_id"] for item in diagnostics], ["S002"])
        self.assertEqual(diagnostics[0]["duplicate_kind"], "WHOLE_SECTION")

    def test_source_copy_diagnostic_uses_only_the_locked_beat_evidence(self):
        source = "Nhân vật chính bước vào căn phòng tối và nhìn thấy chiếc hộp cũ nằm dưới ánh đèn"
        copied_script = (
            source
            + " Sau đó nhóm nhân vật cân nhắc kế hoạch mới trước khi rời khỏi căn phòng trong im lặng."
        )
        draft = NarrativeDraft(
            sections=[
                WrittenSection(section_id="S001", script_source_lang=copied_script),
                WrittenSection(section_id="S002", script_source_lang=copied_script),
            ]
        )
        allocated = [
            {
                "section_id": "S001",
                "target_chars": 100,
                "blocks": [{"full_text": source}],
            },
            {
                "section_id": "S002",
                "target_chars": 100,
                "blocks": [{"full_text": "A different locked event happens later."}],
            },
        ]

        diagnostics = narrative_summarize_gateway._narrative_verbatim_diagnostics(
            draft,
            allocated,
        )

        self.assertEqual([item["section_id"] for item in diagnostics], ["S001"])
        self.assertGreaterEqual(diagnostics[0]["run_words"], 15)
        self.assertFalse(diagnostics[0]["terminal_after_budget"])
        self.assertEqual(diagnostics[0]["source_evidence"], source)

    def test_cross_batch_whole_section_duplicate_is_seen_after_draft_merge(self):
        repeated = "This grounded sentence belongs to one locked source beat."
        draft = NarrativeDraft(
            sections=[
                WrittenSection(
                    section_id=f"S{index:03d}",
                    script_source_lang=(repeated if index in {1, 13} else f"Unique beat {index} narration."),
                )
                for index in range(1, 14)
            ]
        )
        allocated = [
            {
                "section_id": f"S{index:03d}",
                "target_chars": 100,
                "blocks": [{"full_text": f"Locked source beat {index}."}],
            }
            for index in range(1, 14)
        ]

        diagnostics = narrative_summarize_gateway._narrative_quality_diagnostics(
            draft,
            allocated,
            language="en",
        )

        duplicate = [
            item for item in diagnostics
            if item.get("violation") == "DUPLICATE_NARRATION"
        ]
        self.assertEqual([item["section_id"] for item in duplicate], ["S013"])
        self.assertEqual(duplicate[0]["duplicate_kind"], "WHOLE_SECTION")


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
        self.assertEqual(refs, [(0, 60_000), (120_000, 180_000)])

    async def test_unbounded_short_source_can_emit_more_than_32_ordered_beats(self):
        req = _request()
        req.transcript = [
            SttSegment(
                text=f"Timed story event {index}",
                start_ms=index * 8_000,
                end_ms=(index + 1) * 8_000,
            )
            for index in range(220)
        ]
        req.duration_ms = 1_760_000
        req.max_sections = None
        req.target_duration_ms = 300_000

        with patch.object(narrative_summarize_gateway.settings, "mock_mode", True):
            response = await narrative_summarize_gateway.summarize_narrative(req)

        self.assertEqual(response.status, "COMPLETED")
        plan = response.plans[0]
        self.assertGreater(len(plan.sections), 32)
        refs = [
            (ref.start_ms, ref.end_ms)
            for section in plan.sections
            for ref in section.source_refs
        ]
        self.assertEqual(refs, sorted(refs))
        self.assertEqual(refs[0][0], 0)
        self.assertGreaterEqual(refs[-1][1], 1_700_000)
        self.assertTrue(270_000 <= sum(end - start for start, end in refs) <= 330_000)

    async def test_short_source_uses_maximum_grounded_coverage_and_warning(self):
        req = _duration_request(40_000, 60_000)

        with patch.object(narrative_summarize_gateway.settings, "mock_mode", True):
            response = await narrative_summarize_gateway.summarize_narrative(req)

        self.assertEqual(response.status, "COMPLETED")
        plan = response.plans[0]
        coverage = sum(
            ref.end_ms - ref.start_ms
            for section in plan.sections
            for ref in section.source_refs
        )
        self.assertEqual(coverage, 40_000)
        self.assertIn("SHORTER_THAN_REQUESTED", plan.warnings)

    async def test_duration_matrix_uses_timed_units_when_canonical_blocks_are_too_coarse(self):
        cases = [
            (120_000, 30_000, 12_000),
            (531_000, 240_000, 10_000),
            (900_000, 300_000, 10_000),
            (1_740_000, 300_000, 10_000),
        ]

        with patch.object(narrative_summarize_gateway.settings, "mock_mode", True):
            for source_duration_ms, target_duration_ms, segment_duration_ms in cases:
                response = await narrative_summarize_gateway.summarize_narrative(
                    _duration_request(
                        source_duration_ms,
                        target_duration_ms,
                        segment_duration_ms,
                    )
                )

                self.assertEqual(response.status, "COMPLETED")
                refs = [
                    (ref.start_ms, ref.end_ms)
                    for section in response.plans[0].sections
                    for ref in section.source_refs
                ]
                coverage = sum(end - start for start, end in refs)
                min_ms, max_ms = duration_window(target_duration_ms)
                self.assertTrue(min_ms <= coverage <= max_ms)
                self.assertEqual(refs, sorted(refs))
                self.assertLessEqual(refs[0][0], source_duration_ms // 4)
                self.assertGreaterEqual(refs[-1][1], source_duration_ms * 3 // 4)


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
        for index, section in enumerate(short["sections"]):
            section["script_source_lang"] = f"{short_script} Section {index} remains distinct."

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

    async def test_pacing_repair_accepts_null_beat_type_note_from_provider(self):
        short = _writer_payload()
        short_script = " ".join(
            f"Short detail {index} keeps the selected beat grounded in context."
            for index in range(7)
        )
        for index, section in enumerate(short["sections"]):
            section["script_source_lang"] = f"{short_script} Section {index} remains distinct."

        repaired = _writer_payload()
        for section in repaired["sections"]:
            section["beat_type_note"] = None

        response, chat_mock = await self._run(
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(short)),
                _chat_result(json.dumps(repaired)),
            ]
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertIsNone(response.error)
        self.assertEqual(chat_mock.await_count, 3)
        repair_call = chat_mock.await_args_list[2]
        self.assertIn("Use only the keys defined by the current <output_format>", repair_call.args[1])
        self.assertIn("beat_type_note", repair_call.args[1])
        self.assertEqual(
            repaired["sections"][0]["script_source_lang"],
            response.plans[0].sections[0].script_source_lang,
        )
        self.assertNotIn("beat_type_note", response.plans[0].sections[0].model_dump())

    async def test_overlong_writer_is_repaired_before_narrative_completion(self):
        overlong = _writer_payload()
        overlong_script = " ".join(
            f"Overlong detail {index} expands the selected beat beyond the pacing estimate."
            for index in range(20)
        )
        for index, section in enumerate(overlong["sections"]):
            section["script_source_lang"] = f"{overlong_script} Section {index} remains distinct."

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

    async def test_residual_underfill_gets_one_additional_bounded_correction(self):
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
                _chat_result(json.dumps(_writer_payload())),
            ]
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 4)

        self.assertIsNone(response.error)
        correction_prompt = chat_mock.await_args_list[3].args[2]
        self.assertIn("current_script", correction_prompt)
        self.assertIn("Preserve the existing grounded narration", correction_prompt)

    async def test_writer_batches_keep_more_than_32_beats_contiguous_and_local(self):
        allocated = [
            {
                "section_id": f"S{index:03d}",
                "title": "Story beat",
                "goal": "Present the locked event",
                "beat_hint": "BODY",
                "blocks": [{
                    "block_id": f"B{index:03d}",
                    "start_ms": index * 6_000,
                    "end_ms": (index + 1) * 6_000,
                    "full_text": f"Locked source evidence for beat {index}.",
                }],
            }
            for index in range(1, 34)
        ]

        def batch_payload(batch: list[dict]) -> str:
            return json.dumps({
                "sections": [
                    {
                        "section_id": section["section_id"],
                        "heading": section["title"],
                        "script_source_lang": (
                            f"The writer describes {section['section_id']} from its locked evidence."
                        ),
                    }
                    for section in batch
                ]
            })

        batches = [allocated[index:index + 12] for index in range(0, len(allocated), 12)]
        stage_mock = AsyncMock(
            side_effect=[_chat_result(batch_payload(batch)) for batch in batches]
        )
        with patch.object(narrative_summarize_gateway, "_call_json_stage", stage_mock):
            draft, results = await narrative_summarize_gateway._call_narrative_writer_batches(
                _request(),
                allocated,
                language="en",
                intent={"goal_type": "SUMMARIZE_GENERATIVE"},
                constraints=[],
                content_brief="global brief must stay out of a local batch",
                multimodal_context=None,
                beat_visuals=None,
                stage="NARRATIVE_WRITING",
            )

        self.assertEqual(len(results), 3)
        self.assertEqual(stage_mock.await_count, 3)
        self.assertEqual(
            [section.section_id for section in draft.sections],
            [f"S{index:03d}" for index in range(1, 34)],
        )
        first_user_prompt = stage_mock.await_args_list[0].args[3]
        second_user_prompt = stage_mock.await_args_list[1].args[3]
        self.assertIn('section_id="S001"', first_user_prompt)
        self.assertIn('section_id="S012"', first_user_prompt)
        self.assertNotIn('section_id="S013"', first_user_prompt)
        self.assertIn('section_id="S013"', second_user_prompt)
        self.assertNotIn('section_id="S001"', second_user_prompt)
        self.assertNotIn("global brief must stay out", first_user_prompt)

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
        corrected = _writer_payload()
        for index, section in enumerate(corrected["sections"]):
            section["script_source_lang"] = _numbered_script(
                f"Corrected section {index}",
                1_000,
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
                    _chat_result(json.dumps(corrected)),
                ]
            )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 4)
        self.assertIsNone(response.error)
        self.assertEqual(
            response.plans[0].sections[0].script_source_lang,
            corrected["sections"][0]["script_source_lang"],
        )
        self.assertTrue(
            any(
                warning.startswith("NARRATION_PACING_ESTIMATE_RESIDUAL:")
                for warning in response.plans[0].warnings
            )
        )

    async def test_duplicate_writer_output_gets_one_targeted_repair(self):
        duplicate = _duplicate_writer_payload()
        repaired = _writer_payload()

        response, chat_mock = await self._run(
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(duplicate)),
                _chat_result(json.dumps(repaired)),
            ]
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 3)
        repair_prompt = chat_mock.await_args_list[2].args[2]
        duplicate_block = repair_prompt.split("<duplicate_repair>", 1)[1].split(
            "</duplicate_repair>", 1
        )[0]
        self.assertIn('section_id="S002"', duplicate_block)
        self.assertNotIn('section_id="S001"', duplicate_block)
        self.assertIn("target_chars", duplicate_block)
        self.assertIn("current_script", duplicate_block)
        self.assertIn("source grounding", duplicate_block)
        self.assertEqual(
            response.plans[0].sections[1].script_source_lang,
            repaired["sections"][1]["script_source_lang"],
        )

    async def test_same_language_source_copy_is_repaired_with_pacing_in_one_request(self):
        source = "Nhân vật chính bước vào căn phòng tối và nhìn thấy chiếc hộp cũ nằm dưới ánh đèn"
        copied = _verbatim_writer_payload(source)
        repaired = _writer_payload()

        response, chat_mock = await self._run(
            request=_same_language_verbatim_request(),
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(copied)),
                _chat_result(json.dumps(repaired)),
            ],
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 3)
        repair_prompt = chat_mock.await_args_list[2].args[2]
        self.assertIn("<source_copy_repair>", repair_prompt)
        self.assertIn("<pacing_repair>", repair_prompt)
        self.assertNotIn("<duplicate_repair>", repair_prompt)

    async def test_clear_source_copy_after_two_repairs_is_non_retryable(self):
        source = "Nhân vật chính bước vào căn phòng tối và nhìn thấy chiếc hộp cũ nằm dưới ánh đèn"
        copied = _verbatim_writer_payload(source, whole_sentence=True)

        response, chat_mock = await self._run(
            request=_same_language_verbatim_request(),
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(copied)),
                _chat_result(json.dumps(copied)),
                _chat_result(json.dumps(copied)),
            ],
        )

        self.assertEqual(response.status, "FAILED")
        self.assertEqual(chat_mock.await_count, 4)
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION.value,
        )
        self.assertFalse(response.error_detail.retryable)

    async def test_duplicate_repair_exhaustion_fails_closed_without_loop(self):
        duplicate = _duplicate_writer_payload()

        response, chat_mock = await self._run(
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(duplicate)),
                _chat_result(json.dumps(duplicate)),
                _chat_result(json.dumps(duplicate)),
            ]
        )

        self.assertEqual(response.status, "FAILED")
        self.assertEqual(chat_mock.await_count, 4)
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION.value,
        )
        self.assertFalse(response.error_detail.retryable)

    async def test_tiny_section_estimate_residual_does_not_fail_valid_narration(self):
        tiny = _writer_payload()
        tiny["sections"][0]["script_source_lang"] = _numbered_script(
            "Tiny opening", 925
        )
        tiny["sections"][1]["script_source_lang"] = _numbered_script(
            "Tiny conclusion", 840
        )

        response, chat_mock = await self._run(
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(tiny)),
                _chat_result(json.dumps(tiny)),
                _chat_result(json.dumps(tiny)),
            ]
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 4)
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
            [(0, 60_000), (120_000, 180_000)],
        )
        self.assertEqual(response.usage.input_tokens, 40)
        self.assertEqual(response.usage.output_tokens, 60)

        planning_call, writer_call = chat_mock.await_args_list
        self.assertIn("SEMANTIC", planning_call.args[1].upper())
        self.assertIn("Opening premise", planning_call.args[2])
        self.assertNotIn("start_ms", planning_call.args[2])
        self.assertNotIn("source_refs", planning_call.args[2])
        self.assertIn("Opening premise", writer_call.args[2])
        self.assertIn("Closing takeaway", writer_call.args[2])
        self.assertNotIn("Main idea", writer_call.args[2])
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

    async def test_deepseek_dashscope_reasoning_json_is_parsed_by_semantic_stage(self):
        from app.services.protocol.dashscope_native import DashScopeNativeAdapter

        provider = ProviderPayload(
            protocol="dashscope_native",
            base_url="https://dashscope.test/compatible-mode/v1",
            api_key="sk-real-key",
            model="deepseek-v4.1-flash",
        )
        planning_text = DashScopeNativeAdapter()._extract_text({
            "choices": [{"message": {
                "content": "",
                "reasoning_content": json.dumps(_semantic_payload()),
            }}],
        })
        response, chat_mock = await self._run(
            provider=provider,
            side_effect=[
                _chat_result(planning_text),
                _chat_result(json.dumps(_writer_payload())),
            ],
        )

        self.assertEqual("COMPLETED", response.status)
        self.assertEqual(
            {"enable_thinking": False},
            chat_mock.await_args_list[0].kwargs["extra_body"],
        )

    async def test_deepseek_reasoning_prose_still_fails_semantic_schema(self):
        from app.services.protocol.dashscope_native import DashScopeNativeAdapter

        provider = ProviderPayload(
            protocol="dashscope_native",
            base_url="https://dashscope.test/compatible-mode/v1",
            api_key="sk-real-key",
            model="deepseek-v4.1-flash",
        )
        prose = DashScopeNativeAdapter()._extract_text({
            "choices": [{"message": {
                "content": "",
                "reasoning_content": "I should construct the semantic plan next.",
            }}],
        })
        response, chat_mock = await self._run(
            provider=provider,
            side_effect=[_chat_result(prose)],
        )

        self.assertEqual("FAILED", response.status)
        self.assertEqual(
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED.value,
            response.error_detail.errorCode,
        )
        self.assertEqual(1, chat_mock.await_count)

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
        # Overlapping ASR segments inside one block split at sentence boundaries
        # into an extra beat (coverage-preserving); the writer must cover it.
        writer["sections"].append({
            "section_id": "S003",
            "heading": "Takeaway continued",
            "script_source_lang": " ".join(
                f"Closing detail {index} keeps the final beat grounded."
                for index in range(11)
            ),
            "beat_type": "PAYOFF",
            "notes": None,
        })

        response, chat_mock = await self._run(
            request=req,
            side_effect=[
                _chat_result(json.dumps(_semantic_payload())),
                _chat_result(json.dumps(writer)),
                _chat_result(json.dumps({
                    "sections": [
                        {**writer["sections"][0]},
                        {**writer["sections"][2]},
                    ],
                })),
                _chat_result(json.dumps({
                    "sections": [
                        {**writer["sections"][0]},
                        {**writer["sections"][2]},
                    ],
                })),
            ],
        )

        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(chat_mock.await_count, 4)


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

    def test_semantic_prompt_guides_late_resolution_essentiality_without_credit_bias(self):
        from app.core.prompts import build_narrative_semantic_plan_prompt

        # The guidance is system-level; this test exercises the actual builder
        # contract without requiring an LLM call.
        system, _ = build_narrative_semantic_plan_prompt(
            [{
                "block_id": "B001",
                "ordered_index": 1,
                "text_preview": "The outcome resolves the central conflict.",
            }],
            language="en",
            intent={"goal_type": "SUMMARIZE_GENERATIVE"},
            constraints=[],
            max_sections=3,
        )
        self.assertIn("late resolution, outcome, or conclusion", system)
        self.assertIn("credits, ending music", system)
        self.assertIn("soft preferences", system)

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
