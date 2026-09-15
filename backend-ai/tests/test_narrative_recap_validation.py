"""Recap sentence-structure validation tests (Generative Sentence-Level SRT)."""
from __future__ import annotations

import unittest

from app.schemas.contract import (
    NarrativeIntentSlice,
    NarrativeSummarizeRequest,
    ProviderPayload,
    SttSegment,
)
from app.services import narrative_summarize_gateway as gw
from app.services.allocator import AllocationError, allocate_blocks
from app.services.narrative_planning_models import (
    BlockRanking,
    NarrativeDraft,
    SemanticPlan,
    SemanticSection,
    TranscriptBlock,
    WrittenSection,
)


def _req():
    return NarrativeSummarizeRequest(
        correlation_id="c",
        media_job_id="j",
        transcript=[SttSegment(text="x", start_ms=0, end_ms=60_000)],
        language="vi",
        duration_ms=60_000,
        intent=NarrativeIntentSlice(goal_type="SUMMARIZE_GENERATIVE", target_langs=["vi"]),
        constraints=[],
        max_sections=5,
        target_duration_ms=60_000,
        provider=ProviderPayload(
            protocol="openai_compatible",
            base_url="https://p.test/v1",
            api_key="sk-real",
            model="m",
        ),
    )


def _allocation(texts=("Nguồn một.", "Nguồn hai.")):
    blocks = [
        TranscriptBlock(
            block_id=f"B{i+1:03d}",
            start_ms=i * 60_000,
            end_ms=(i + 1) * 60_000,
            duration_ms=60_000,
            text_preview=t[:60],
            ordered_index=i + 1,
            full_text=t,
        )
        for i, t in enumerate(texts)
    ]
    plan = SemanticPlan(
        sections=[SemanticSection(section_id="S001", title="Mở", goal="Mở đầu")],
        block_rankings=[
            BlockRanking(block_id=b.block_id, importance=0.9, section_id="S001") for b in blocks
        ],
    )
    return plan, allocate_blocks(blocks, 60_000, plan)


def _single_section_draft(script):
    return NarrativeDraft(
        title="T",
        sections=[WrittenSection(section_id="S001", heading="Mở", script_source_lang=script)],
        confidence=0.8,
    )


class RecapValidationTest(unittest.TestCase):
    def test_valid_multi_sentence_recap_accepted(self):
        plan, alloc = _allocation()
        script = (
            "Luck ở lại chặn hậu cho đồng đội rút lui. "
            "Goran và Eric phá kết giới trong vô vọng. "
            "Cậu một mình lao vào quân đoàn ma thần. "
            "Cảm ơn mọi người đã xem video."
        )
        out = gw._build_plan(_req(), plan, alloc, _single_section_draft(script))
        self.assertEqual(1, len(out.sections))

    def test_single_huge_paragraph_rejected(self):
        plan, alloc = _allocation()
        script = " ".join(["câu chuyện kéo dài với rất nhiều chi tiết phức tạp"] * 12) + "."
        with self.assertRaises(AllocationError):
            gw._build_plan(_req(), plan, alloc, _single_section_draft(script))

    def test_empty_script_rejected(self):
        plan, alloc = _allocation()
        with self.assertRaises(Exception):
            gw._build_plan(_req(), plan, alloc, _single_section_draft("   "))

    def test_duplicate_narration_rejected(self):
        plan, alloc = _allocation()
        s = "Nào, hãy nói ước nguyện của ngươi thật rõ ràng cho mọi người."
        with self.assertRaises(AllocationError):
            gw._build_plan(_req(), plan, alloc, _single_section_draft(f"{s} {s} {s}"))

    def test_verbatim_dialogue_rejected(self):
        source = (
            "Nào Cliff Grimoire hãy nói ra bất kỳ ước nguyện nào của ngươi vì công lao "
            "ngươi đã cho ta ăn là rất lớn trong nửa năm qua rồi đó bạn ơi"
        )
        plan, alloc = _allocation(texts=(source,))
        script = (
            f"{source}. "
            "Sau đó mọi người bàn bạc kế hoạch tiếp theo cho hành trình."
        )
        with self.assertRaises(AllocationError):
            gw._build_plan(_req(), plan, alloc, _single_section_draft(script))

    def test_cjk_copy_rejected(self):
        plan, alloc = _allocation()
        script = "Luck lao lên chiến đấu. 刚才他说了那样的话肯定在策划什么阴谋诡计很大. Cậu thắng."
        with self.assertRaises(AllocationError):
            gw._build_plan(_req(), plan, alloc, _single_section_draft(script))

    def test_cjk_language_accepted(self):
        plan, alloc = _allocation()
        req = _req()
        req.language = "zh-CN"
        script = "云南菜未能列入八大菜系，并非因为实力不足，而是现有的框架根本无法容纳它的丰富。这片土地拥有二十六个民族和一百多种可食用野生菌。"
        out = gw._build_plan(req, plan, alloc, _single_section_draft(script))
        self.assertEqual(1, len(out.sections))


if __name__ == "__main__":
    unittest.main()
