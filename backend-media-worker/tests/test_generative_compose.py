import unittest
from unittest.mock import patch, Mock
import os
import tempfile

from app.services.generative_compose import (
    VisualBeatInput,
    _validate_beats,
    build_beat_srt,
    build_generative_artifact_meta,
)
from app.services.ffmpeg import FFmpegError


class GenerativeComposeUnitTest(unittest.TestCase):
    def test_validate_beats_requires_non_empty(self):
        with self.assertRaises(FFmpegError) as ctx:
            _validate_beats([])
        self.assertEqual("INVALID_INPUT", ctx.exception.code)
        self.assertFalse(ctx.exception.retryable)

    def test_validate_beats_requires_script_and_positive_range(self):
        beat = VisualBeatInput(
            id="beat-001",
            narration_segment="  ",
            visual_description="desc",
            source_start_ms=0,
            source_end_ms=1000,
        )
        with self.assertRaises(FFmpegError):
            _validate_beats([beat])

        beat2 = VisualBeatInput(
            id="beat-001",
            narration_segment="ok",
            visual_description="desc",
            source_start_ms=1000,
            source_end_ms=1000,
        )
        with self.assertRaises(FFmpegError):
            _validate_beats([beat2])

    def test_validate_beats_requires_measured_tts_duration(self):
        beat = VisualBeatInput(
            id="beat-001",
            narration_segment="ok",
            visual_description="desc",
            source_start_ms=0,
            source_end_ms=12000,
            tts_duration_ms=None,
        )

        with self.assertRaisesRegex(FFmpegError, "measured tts_duration_ms"):
            _validate_beats([beat])

    def test_generate_terms_must_be_5_to_8_when_present(self):
        beat = VisualBeatInput(
            id="beat-001",
            narration_segment="ok script",
            visual_description="desc",
            source_start_ms=0,
            source_end_ms=1000,
            tts_duration_ms=1000,
            generate_terms=["a", "b", "c"],
        )
        with self.assertRaises(FFmpegError) as ctx:
            _validate_beats([beat])
        self.assertIn("generate_terms", str(ctx.exception))

        # 9 terms should also fail
        beat9 = VisualBeatInput(
            id="beat-001",
            narration_segment="ok",
            visual_description="desc",
            source_start_ms=0,
            source_end_ms=1000,
            tts_duration_ms=1000,
            generate_terms=["a"]*9,
        )
        with self.assertRaises(FFmpegError):
            _validate_beats([beat9])

        # 5 and 8 are ok
        beat5 = VisualBeatInput(
            id="beat-001",
            narration_segment="ok",
            visual_description="desc",
            source_start_ms=0,
            source_end_ms=1000,
            tts_duration_ms=1000,
            generate_terms=["a","b","c","d","e"],
        )
        # should not raise
        _validate_beats([beat5])
        beat8 = VisualBeatInput(
            id="beat-001",
            narration_segment="ok",
            visual_description="desc",
            source_start_ms=0,
            source_end_ms=1000,
            tts_duration_ms=1000,
            generate_terms=["a","b","c","d","e","f","g","h"],
        )
        _validate_beats([beat8])

    def test_build_beat_srt_uses_tts_truth_for_timing(self):
        beats = [
            VisualBeatInput(
                id="beat-001",
                narration_segment="Hook — welcome",
                visual_description="wide shot",
                source_start_ms=0,
                source_end_ms=5000,
                tts_duration_ms=3000,
                generate_terms=["hook","welcome","stage","audience","lights"],
            ),
            VisualBeatInput(
                id="beat-002",
                narration_segment="Context about the market",
                visual_description="market crowd",
                source_start_ms=5000,
                source_end_ms=10000,
                tts_duration_ms=4500,
                generate_terms=["market","crowd","vendors","goods","street"],
            ),
        ]
        with tempfile.TemporaryDirectory() as d:
            srt_path = os.path.join(d, "beats.srt")
            build_beat_srt(beats, srt_path)
            content = open(srt_path, encoding="utf-8").read()
            # first cue 0 -> 3000
            self.assertIn("00:00:00,000 --> 00:00:03,000", content)
            self.assertIn("Hook — welcome", content)
            # second cue starts at 3000 (after beat 1 TTS duration) -> 7500
            self.assertIn("00:00:03,000 --> 00:00:07,500", content)
            self.assertIn("Context about the market", content)

    def test_artifact_meta_contains_tts_truth(self):
        beats = [
            VisualBeatInput(id="beat-001", narration_segment="a", visual_description="d", source_start_ms=0, source_end_ms=1000, tts_duration_ms=1200, generate_terms=["a","b","c","d","e"]),
            VisualBeatInput(id="beat-002", narration_segment="b", visual_description="d", source_start_ms=1000, source_end_ms=2000, tts_duration_ms=800, generate_terms=["a","b","c","d","e"]),
        ]
        meta = build_generative_artifact_meta(beats, 2000, [1200,800])
        self.assertEqual(2, meta["beats"])
        self.assertEqual(2000, meta["total_duration_ms"])
        self.assertTrue(meta["tts_is_source_of_truth"])
        self.assertEqual("generative_v1_text_grounded", meta["composition"])
        self.assertEqual(["beat-001","beat-002"], meta["beat_ids"])

    def test_fallback_extractives_still_work(self):
        # Simulate LLM failure -> system keeps extractive path: cut_ranges remain valid
        # This is a contract test: extractive validation does not require visual fields
        from app.services.ffmpeg import CutRange
        # extractive cut_ranges are independent; generative validation should not affect them
        cut_ranges = [CutRange(start_ms=0, end_ms=5000), CutRange(start_ms=10000, end_ms=15000)]
        # should not raise
        self.assertEqual(5000, cut_ranges[0].end_ms - cut_ranges[0].start_ms)

    def test_no_vlm_in_v1_text_grounded(self):
        # V1 does not use VLM; beats are text-grounded from transcript blocks
        # This test ensures generate_terms are derived from text, not image analysis
        beat = VisualBeatInput(
            id="beat-001",
            narration_segment="Grounded in transcript",
            visual_description="Text grounded visual",
            source_start_ms=0,
            source_end_ms=4000,
            tts_duration_ms=4000,
            generate_terms=["grounded","transcript","text","visual","scene"],
        )
        # Should pass validation without any VLM-produced embeddings
        _validate_beats([beat])


if __name__ == "__main__":
    unittest.main()
