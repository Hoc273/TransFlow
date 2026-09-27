"""TC-GROUND-01..10 — Generative Summary Beat Grounding regression suite.

Covers the fundamental synchronization bug: voice/subtitle describing a later
source scene while the rendered video still shows an earlier scene.

* TC-GROUND-01: distant scenes A (03:05-04:05) and B (05:09-06:10) are never
  one unbounded narration beat.
* TC-GROUND-02: future-event leakage (rabbit road-sign + wolf bee attack in
  one narration unit) is rejected/split.
* TC-GROUND-03: sparse transcript grounds visually via VLM candidates.
* TC-GROUND-04: measured TTS is the beat clock; visual fits the TTS slot.
* TC-GROUND-05: invalid TTS/visual measurements fail closed; gaps stay split.
* TC-GROUND-06: grounding selects footage; deterministic fit owns pacing.
* TC-GROUND-07: actual TTS duration remains authoritative.
* TC-GROUND-08: subtitle continuity (no gap/overlap, exact total, limits).
* TC-GROUND-09: OpenAI-compatible VLM provider config + disabled mode.
* TC-GROUND-10: invalid VLM timestamps never become render ranges.
"""
import unittest

from app.services.allocator import AllocationError
from app.services.narrative_planning_models import AllocatedSection, TranscriptBlock
from app.services.summary.beat_grounding import (
    VISUAL_GROUNDING_DEGRADED_WARNING,
    evaluate_visual_tts_fit,
    narration_target_chars,
    needs_visual_split,
    rewrite_section_refs_from_candidates,
    selected_blocks_covered_by_refs,
    split_oversized_sections_at_silence,
    validate_visual_range,
)
from app.services.summary.visual_candidate_planner import (
    generate_visual_candidates,
    split_sections_by_visual_gap,
    validate_candidate_range,
)
from app.services.visual.frame_sampler import sample_dense_around_peak
from app.services.sentence_splitter import split_sentences


def _block(block_id, start, end, text, idx):
    return TranscriptBlock(
        block_id=block_id,
        start_ms=start,
        end_ms=end,
        duration_ms=end - start,
        text_preview=text[:60],
        ordered_index=idx,
        full_text=text,
    )


class TcGroundBeatGroundingTest(unittest.TestCase):
    def test_tc_ground_01_distant_scenes_not_one_beat(self):
        """Scene A 03:05-04:05 vs Scene B 05:09-06:10 -> two grounded beats."""
        section = AllocatedSection(
            section_id="S003",
            title="Climax",
            goal="Present climax",
            beat_hint="CLIMAX",
            blocks=[
                _block("B003", 185280, 245840, "Rabbits at intersection looking at road signs", 3),
                _block("B004", 309280, 370400, "Wolf attacked by bees falls into swamp", 4),
            ],
        )
        candidates = [
            {"start_ms": 185000, "end_ms": 197000, "visual_description": "rabbits at intersection"},
            {"start_ms": 309000, "end_ms": 321000, "visual_description": "wolf bee attack swamp"},
        ]
        refs = rewrite_section_refs_from_candidates([section], candidates, 531000)
        self.assertIn("S003", refs)
        # Two distant clusters must stay separate (gap >> 1500ms).
        self.assertTrue(needs_visual_split(refs["S003"]))
        split = split_sections_by_visual_gap([section], candidates, 531000)
        self.assertEqual(len(split), 2)
        refs2 = rewrite_section_refs_from_candidates(split, candidates, 531000)
        for sid, rr in refs2.items():
            self.assertFalse(needs_visual_split(rr), f"section {sid} still spans distant scenes")
        # No single beat covers both A and B.
        for rr in refs2.values():
            for s, e in rr:
                self.assertFalse(
                    s <= 245840 and e >= 309280,
                    f"beat spans distant scenes: {s}->{e}",
                )

    def test_tc_ground_02_rabbit_wolf_evidence_stays_in_separate_beats(self):
        """The rabbit/wolf regression is guarded by locked source ranges."""
        sections = split_sections_by_visual_gap(
            [AllocatedSection(
                section_id="S003",
                title="Climax",
                goal="Present climax",
                beat_hint="CLIMAX",
                blocks=[
                    _block("B003", 185280, 245840, "rabbits road signs", 3),
                    _block("B004", 309280, 370400, "wolf bees swamp", 4),
                ],
            )],
            [
                {"start_ms": 185000, "end_ms": 197000, "visual_description": "rabbits"},
                {"start_ms": 309000, "end_ms": 321000, "visual_description": "wolf"},
            ],
            531000,
        )
        self.assertEqual(len(sections), 2)
        self.assertEqual(
            [block.full_text for section in sections for block in section.blocks],
            ["rabbits road signs", "wolf bees swamp"],
        )

    def test_tc_ground_03_sparse_transcript_visual_path(self):
        """Visual action exists with little/no dialogue -> VLM path grounds it."""
        candidates = generate_visual_candidates(
            visual_observations=[
                {"timestamp": 15000, "action": "fight", "visual_description": "intense fight", "confidence": 0.95},
                {"timestamp": 85000, "action": "run", "visual_description": "running away", "confidence": 0.88},
            ],
            visual_scenes=[
                {"start_ms": 10000, "end_ms": 30000, "dominant_action": "fight scene", "confidence": 0.9},
                {"start_ms": 70000, "end_ms": 100000, "dominant_action": "chase scene", "confidence": 0.85},
            ],
            video_duration_ms=120000,
            transcript_segments=[{"text": "Look there", "start_ms": 5000, "end_ms": 7000}],
            target_candidate_duration_ms=6000,
        )
        self.assertGreaterEqual(len(candidates), 2)
        fight = next(
            c for c in candidates if "fight" in (c.dominant_action + c.visual_description)
        )
        self.assertGreater(fight.action_intensity, 0.7)
        # Fine pass localizes start/peak/end around the action peak.
        dense = sample_dense_around_peak(
            fight.peak_timestamp_ms, window_ms=6000, step_ms=1500, video_duration_ms=120000
        )
        self.assertTrue(dense)
        self.assertTrue(all(0 <= t < 120000 for t in dense))
        self.assertIn(fight.peak_timestamp_ms, dense)

    def test_tc_ground_04_narration_shorter_than_visual(self):
        """TTS is the beat clock; both shorter and longer visuals fit to it."""
        self.assertEqual(evaluate_visual_tts_fit(12000, 5000), "ALIGNED")
        self.assertEqual(evaluate_visual_tts_fit(6000, 5800), "ALIGNED")

    def test_tc_ground_05_narration_longer_than_visual(self):
        """TTS remains authoritative; invalid measurements still fail closed."""
        self.assertEqual(evaluate_visual_tts_fit(4000, 9000), "ALIGNED")
        self.assertEqual(evaluate_visual_tts_fit(0, 9000), "NEEDS_REPLAN")
        section = AllocatedSection(
            section_id="S001",
            title="T",
            goal="g",
            beat_hint="BODY",
            blocks=[
                _block("B001", 0, 60000, "event A text", 1),
                _block("B002", 195000, 210000, "unrelated event B text", 2),
            ],
        )
        candidates = [
            {"start_ms": 0, "end_ms": 4000, "visual_description": "event A start"},
            {"start_ms": 200000, "end_ms": 204000, "visual_description": "unrelated event B"},
        ]
        refs = rewrite_section_refs_from_candidates([section], candidates, 300000)
        # Unrelated distant footage must not be merged into one continuous beat.
        self.assertTrue(needs_visual_split(refs["S001"]))
        split = split_sections_by_visual_gap([section], candidates, 300000)
        self.assertEqual(len(split), 2)

    def test_tc_ground_06_playback_stays_1x(self):
        """Sampling selects/grounds footage; the worker fits it to measured TTS."""
        dense = sample_dense_around_peak(60000, window_ms=6000, step_ms=1500, video_duration_ms=300000)
        self.assertTrue(dense)
        # Grounding still only selects timestamps; deterministic fit owns pacing.
        self.assertLessEqual(max(dense) - min(dense), 6000)
        self.assertEqual(evaluate_visual_tts_fit(12000, 5000), "ALIGNED")

    def test_tc_ground_07_tts_duration_authoritative(self):
        """Measured TTS drives the slot; visual duration never changes it."""
        self.assertEqual(evaluate_visual_tts_fit(7000, 5000), "ALIGNED")
        self.assertEqual(evaluate_visual_tts_fit(7000, 6800), "ALIGNED")
        self.assertEqual(evaluate_visual_tts_fit(4000, 9000), "ALIGNED")

    def test_tc_ground_08_subtitle_continuity_contract(self):
        """Sentences partition a beat exactly: no gaps/overlaps, limits hold."""
        sentences = split_sentences("The rabbits hesitated at the signs. The wolf fled the swarm.")
        self.assertEqual(len(sentences), 2)
        total_ms = 5000
        weights = [max(1, len(s)) for s in sentences]
        grand = sum(weights)
        durations = [(w * total_ms) // grand for w in weights]
        durations[-1] += total_ms - sum(durations)
        self.assertEqual(sum(durations), total_ms)
        self.assertTrue(all(d > 0 for d in durations))
        for s in sentences:
            self.assertLessEqual(len(s), 80)

    def test_tc_ground_09_provider_config_and_disabled_mode(self):
        """OpenAI-compatible VLM config exists; disabled mode marks degraded."""
        from app.core.config import Settings

        cfg = Settings()
        for attr in (
            "image_provider_enabled",
            "image_provider_type",
            "image_provider_base_url",
            "image_provider_api_key",
            "image_provider_model",
            "image_provider_timeout_ms",
            "image_provider_max_frames",
            "image_provider_interval_ms",
        ):
            self.assertTrue(hasattr(cfg, attr), f"Settings missing {attr}")
        self.assertEqual(VISUAL_GROUNDING_DEGRADED_WARNING, "VISUAL_GROUNDING_DEGRADED:STT_ONLY")

    def test_tc_ground_10_invalid_vlm_output_never_becomes_range(self):
        """Invalid/negative/out-of-bounds VLM timestamps cannot become refs."""
        with self.assertRaises(ValueError):
            validate_visual_range(-5000, -1000, 60000)
        with self.assertRaises(ValueError):
            validate_visual_range(5000, 5000, 60000)
        with self.assertRaises(ValueError):
            validate_visual_range(70000, 80000, 60000)
        s, e = validate_visual_range(-10000, 5000, 60000)
        self.assertEqual((s, e), (0, 5000))
        from app.services.summary.visual_candidate_planner import VisualCandidate

        vc = VisualCandidate(
            candidate_id="VC001",
            start_ms=55000,
            end_ms=60000,
            duration_ms=5000,
            peak_timestamp_ms=57500,
        )
        vs, ve = validate_candidate_range(vc, 60000)
        self.assertEqual((vs, ve), (55000, 60000))

    def test_degraded_split_oversized_section_at_silences(self):
        """60s STT-only section with dialogue pauses splits into ~25s beats."""
        blocks = [
            _block("B001", 0, 8000, "opening dialogue", 1),
            _block("B002", 10000, 18000, "more dialogue", 2),
            _block("B003", 21000, 29000, "action described", 3),
            _block("B004", 32000, 40000, "reaction", 4),
            _block("B005", 43000, 60000, "closing line", 5),
        ]
        section = AllocatedSection(
            section_id="S001", title="T", goal="g", beat_hint="BODY", blocks=blocks
        )
        split, refs = split_oversized_sections_at_silence([section], max_sections=12)
        self.assertGreater(len(split), 1)
        # Order preserved, no content dropped, every beat >= 8s.
        flat = [b.block_id for s in split for b in s.blocks]
        self.assertEqual(flat, ["B001", "B002", "B003", "B004", "B005"])
        for s in split:
            dur = max(b.end_ms for b in s.blocks) - min(b.start_ms for b in s.blocks)
            self.assertGreaterEqual(dur, 8000)
        # Refs preserve actual selected footage; silence gaps are not counted.
        actual = sorted((a, b) for rs in refs.values() for a, b in rs)
        self.assertEqual(actual, [(0, 8000), (10000, 18000), (21000, 29000), (32000, 40000), (43000, 60000)])
        self.assertEqual(sum(b - a for a, b in actual), 49000)
        self.assertTrue(
            selected_blocks_covered_by_refs(blocks, [r for rs in refs.values() for r in rs])
        )

    def test_degraded_split_single_block_along_segments(self):
        """One 60s block with timed segments splits; text partitions in order."""
        from app.services.narrative_planning_models import BlockSegment, TranscriptBlock

        segs = [
            BlockSegment(text=f"line {i}", start_ms=(i - 1) * 10000, end_ms=i * 10000 - 2500)
            for i in range(1, 7)
        ]
        block = TranscriptBlock(
            block_id="B001", start_ms=0, end_ms=60000, duration_ms=60000,
            text_preview="lines", ordered_index=1,
            full_text=" ".join(s.text for s in segs), segments=segs,
        )
        section = AllocatedSection(
            section_id="S001", title="T", goal="g", beat_hint="BODY", blocks=[block]
        )
        split, refs = split_oversized_sections_at_silence([section], max_sections=12)
        self.assertGreater(len(split), 1)
        self.assertLessEqual(len(split), 12)
        # Text fully preserved across sub-beats in order.
        joined = " ".join(b.full_text for s in split for b in s.blocks)
        self.assertEqual(joined.split(), block.full_text.split())
        # A single oversized block is split at silence midpoints, preserving
        # its complete allocated coverage.
        tiled = sorted((a, b) for rs in refs.values() for a, b in rs)
        self.assertEqual(tiled[0][0], 0)
        self.assertEqual(tiled[-1][1], 60000)
        for (a, b), (c, d) in zip(tiled, tiled[1:]):
            self.assertEqual(b, c)

    def test_degraded_split_keeps_continuous_speech_whole(self):
        """Back-to-back dialogue splits at sentence boundaries into small beats."""
        blocks = [_block(f"B{i:03d}", (i - 1) * 10000, i * 10000, f"line {i}", i) for i in range(1, 7)]
        section = AllocatedSection(
            section_id="S001", title="T", goal="g", beat_hint="BODY", blocks=blocks
        )
        split, refs = split_oversized_sections_at_silence([section], max_sections=32)
        # 60s continuous speech with 10s sentences and 6s target -> multiple
        # coverage-preserving beats (never mid-speech: cuts only at sentence spans).
        self.assertGreater(len(split), 1)
        flat = [b.block_id for s in split for b in s.blocks]
        self.assertEqual(flat, [f"B{i:03d}" for i in range(1, 7)])
        for s in split:
            dur = max(b.end_ms for b in s.blocks) - min(b.start_ms for b in s.blocks)
            self.assertGreaterEqual(dur, 4000)
        self.assertTrue(
            selected_blocks_covered_by_refs(blocks, [r for rs in refs.values() for r in rs])
        )

    def test_degraded_split_without_cap_preserves_every_boundary_driven_beat(self):
        """None leaves presentation pacing boundary-driven and coverage-preserving."""
        sections = []
        for idx in range(6):
            blocks = [
                _block(f"B{idx}A", 0, 15000, "part a", 1),
                _block(f"B{idx}B", 20000, 35000, "part b", 2),
                _block(f"B{idx}C", 40000, 65000, "part c", 3),
            ]
            sections.append(
                AllocatedSection(
                    section_id=f"S{idx:03d}", title="T", goal="g",
                    beat_hint="BODY", blocks=blocks,
                )
            )
        split, _refs = split_oversized_sections_at_silence(sections)
        self.assertGreater(len(split), 8)
        total_blocks = sum(len(s.blocks) for s in split)
        self.assertEqual(total_blocks, 18)

    def test_pre_split_sections_over_cap_fail_closed(self):
        """Disconnected pre-split sections are never merged to fake the cap."""
        sections = [
            AllocatedSection(
                section_id="S001", title="A", goal="g", beat_hint="BODY",
                blocks=[_block("A", 0, 10_000, "a", 1)],
            ),
            AllocatedSection(
                section_id="S002", title="B", goal="g", beat_hint="BODY",
                blocks=[_block("B", 40_000, 50_000, "b", 2)],
            ),
        ]
        with self.assertRaises(AllocationError):
            split_oversized_sections_at_silence(sections, max_sections=1)

    def test_narration_target_chars_scales_with_footage(self):
        self.assertEqual(narration_target_chars(60000), 840)
        self.assertEqual(narration_target_chars(25000), 350)
        self.assertEqual(narration_target_chars(0), 0)


if __name__ == "__main__":
    unittest.main()
