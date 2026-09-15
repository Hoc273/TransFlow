"""Regression tests for Generative Summary Beat Grounding."""
import unittest

from app.schemas.contract import (
    NarrativeIntentSlice,
    NarrativeSourceRef,
    NarrativeSummarizeRequest,
    ProviderPayload,
    SttSegment,
)
from app.services.narrative_planning_models import (
    AllocatedSection,
    TranscriptBlock,
)
from app.services.narrative_summarize_gateway import (
    split_distant_blocks_into_sections,
    _mock_response,
)
from app.services.summary.visual_candidate_planner import (
    generate_visual_candidates,
    align_visual_candidates_to_sections,
)

class BeatGroundingTest(unittest.TestCase):
    def test_tc_ground_01_distant_scenes_not_merged_into_single_beat(self):
        """TG-GROUND-01: Scene A (03:05-04:05) and Scene B (05:09-06:10) split."""
        block_a = TranscriptBlock(
            block_id="B003",
            start_ms=185_280,
            end_ms=245_840,
            duration_ms=60_560,
            text_preview="Rabbits at intersection",
            ordered_index=3,
            full_text="Rabbits at intersection looking at road signs",
        )
        block_b = TranscriptBlock(
            block_id="B004",
            start_ms=309_280,
            end_ms=370_400,
            duration_ms=61_120,
            text_preview="Wolf bee attack in swamp",
            ordered_index=4,
            full_text="Wolf attacked by bees in swamp",
        )
        section = AllocatedSection(
            section_id="S003",
            title="Climax",
            goal="Present climax",
            beat_hint="CLIMAX",
            blocks=[block_a, block_b],
        )
        split = split_distant_blocks_into_sections([section], max_gap_ms=1500)
        self.assertEqual(len(split), 2)
        self.assertEqual(split[0].section_id, "S001")
        self.assertEqual(split[0].blocks, [block_a])
        self.assertEqual(split[1].section_id, "S002")
        self.assertEqual(split[1].blocks, [block_b])

    def test_tc_ground_02_future_event_leakage_prevented_in_mock_pipeline(self):
        """TC-GROUND-02: Distant scenes split so no section spans across gap."""
        transcript = [
            SttSegment(text="Opening scene", start_ms=0, end_ms=60_000),
            SttSegment(text="Rising action", start_ms=60_000, end_ms=120_000),
            SttSegment(text="Road signs at intersection", start_ms=185_280, end_ms=245_840),
            SttSegment(text="Bee attack in swamp", start_ms=309_280, end_ms=370_400),
            SttSegment(text="Conclusion", start_ms=376_400, end_ms=437_680),
        ]
        req = NarrativeSummarizeRequest(
            correlation_id="test-grounding",
            media_job_id="test-job",
            provider=ProviderPayload(
                protocol="openai_compatible",
                base_url="https://test/v1",
                api_key="",
                model="gpt-4o-mini",
            ),
            transcript=transcript,
            language="en",
            duration_ms=440_000,
            intent=NarrativeIntentSlice(goal_type="SUMMARIZE_GENERATIVE"),
            constraints=[],
            max_sections=6,
            target_duration_ms=300_000,
        )
        resp = _mock_response(req)
        self.assertEqual(resp.status, "COMPLETED")
        plan = resp.plans[0]
        for section in plan.sections:
            for ref in section.source_refs:
                self.assertFalse(
                    ref.start_ms <= 245_840 and ref.end_ms >= 309_280,
                    f"Section {section.seq} spans across distant scenes: {ref.start_ms}->{ref.end_ms}"
                )

    def test_tc_ground_03_sparse_transcript_visual_candidates(self):
        """TC-GROUND-03: Sparse transcript uses visual candidates with action intensity."""
        visual_obs = [
            {"timestamp": 15000, "action": "fight", "visual_description": "intense fight", "confidence": 0.95},
            {"timestamp": 85000, "action": "run", "visual_description": "running away", "confidence": 0.88},
        ]
        visual_scenes = [
            {"start_ms": 10000, "end_ms": 30000, "dominant_action": "fight scene", "confidence": 0.9},
            {"start_ms": 70000, "end_ms": 100000, "dominant_action": "chase scene", "confidence": 0.85},
        ]
        transcript = [{"text": "Look there", "start_ms": 5000, "end_ms": 7000}]
        candidates = generate_visual_candidates(
            visual_observations=visual_obs,
            visual_scenes=visual_scenes,
            video_duration_ms=120000,
            transcript_segments=transcript,
            target_candidate_duration_ms=6000,
        )
        self.assertGreaterEqual(len(candidates), 2)
        fight_cand = next(c for c in candidates if "fight" in c.dominant_action or "fight" in c.visual_description)
        self.assertGreater(fight_cand.action_intensity, 0.7)

        aligned = align_visual_candidates_to_sections(candidates, target_section_count=2, target_duration_ms=12000)
        self.assertEqual(len(aligned), 2)
        self.assertLess(aligned[0].start_ms, aligned[1].start_ms)

if __name__ == '__main__':
    unittest.main()
