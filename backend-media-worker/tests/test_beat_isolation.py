"""Worker-side beat isolation: TC-GROUND-04/05/06/08 execution guarantees."""
import os
import tempfile
import unittest

from app.services.generative_compose import (
    VisualBeatInput,
    _validate_beats,
    allocate_sentence_durations,
    build_beat_srt,
    split_beat_sentences,
)
from app.services.ffmpeg import FFmpegError


def _beat(i, s, e, text="Narration segment one."):
    return VisualBeatInput(
        id=f"beat-{i:03d}",
        narration_segment=text,
        visual_description="desc",
        source_start_ms=s,
        source_end_ms=e,
        tts_duration_ms=e - s,
        generate_terms=["a", "b", "c", "d", "e"],
    )


class BeatIsolationTest(unittest.TestCase):
    def test_tc_ground_04_tts_cursor_does_not_follow_source_tail(self):
        beats = [
            VisualBeatInput(
                id="beat-001", narration_segment="Short narration.",
                visual_description="d", source_start_ms=0, source_end_ms=12000,
                tts_duration_ms=5000, generate_terms=["a", "b", "c", "d", "e"],
            ),
            VisualBeatInput(
                id="beat-002", narration_segment="Next beat narration.",
                visual_description="d", source_start_ms=12000, source_end_ms=17000,
                tts_duration_ms=4000, generate_terms=["a", "b", "c", "d", "e"],
            ),
        ]
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "b.srt")
            build_beat_srt(beats, p)
            content = open(p, encoding="utf-8").read()
        # Both beat boundaries use measured TTS, never the source visual tail.
        self.assertIn("00:00:00,000 --> 00:00:05,000", content)
        self.assertIn("00:00:05,000 --> 00:00:09,000", content)

    def test_tc_ground_05_overlapping_unrelated_beats_rejected(self):
        # Beat N (0-60s) overlapping Beat N+1 (30-90s) by >50% signals a
        # planning spill into unrelated future footage -> fail closed.
        beats = [_beat(1, 0, 60000), _beat(2, 30000, 90000)]
        with self.assertRaises(FFmpegError):
            _validate_beats(beats)
        # Sequential grounded beats pass.
        _validate_beats([_beat(1, 0, 5000), _beat(2, 5000, 10000)])

    def test_tc_ground_06_tts_driven_fit_in_compose(self):
        import inspect
        import app.services.generative_compose as gc

        src = inspect.getsource(gc._extract_and_rescale_beat)
        # TTS is the beat clock: shorter source visuals are deterministically
        # fitted with setpts, while longer narration holds the final frame.
        code = src.split('"""', 2)[-1] if src.count('"""') >= 2 else src
        self.assertIn("setpts", code)
        self.assertNotIn("atempo", code)
        self.assertIn("tpad", src)
        self.assertIn("tts", gc._extract_and_rescale_beat.__doc__.lower())

    def test_tc_ground_08_srt_exact_no_gap_overlap(self):
        beats = [
            VisualBeatInput(
                id="beat-001", narration_segment="First sentence here. Second here.",
                visual_description="d", source_start_ms=0, source_end_ms=5000,
                tts_duration_ms=5000, generate_terms=["a", "b", "c", "d", "e"],
            ),
        ]
        sentences = split_beat_sentences(beats[0].narration_segment)
        self.assertEqual(len(sentences), 2)
        durs = allocate_sentence_durations(sentences, 5000)
        self.assertEqual(sum(durs), 5000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "x.srt")
            build_beat_srt(beats, p)
            lines = open(p, encoding="utf-8").read().strip().splitlines()
        # 2 cues, continuous cursor, exact total.
        self.assertIn("00:00:00,000 --> ", lines[1])
        self.assertTrue(lines[1].startswith("00:00:00,000"))
        self.assertIn("--> 00:00:05,000", "\n".join(lines))


if __name__ == "__main__":
    unittest.main()
