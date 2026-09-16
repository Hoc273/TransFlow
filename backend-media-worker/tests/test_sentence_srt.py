"""Sentence-level SRT tests (TC-SRT-01..12, Option A proportional timing)."""
import os
import re
import tempfile
import unittest

from app.services.ffmpeg import FFmpegError
from app.services.generative_compose import (
    VisualBeatInput,
    allocate_sentence_durations,
    build_beat_srt,
    split_beat_sentences,
    wrap_sentence_to_lines,
)


def _beat(narration, tts_ms, beat_id="beat-001", start=0):
    return VisualBeatInput(
        id=beat_id,
        narration_segment=narration,
        visual_description="desc",
        source_start_ms=start,
        source_end_ms=start + 60_000,
        tts_duration_ms=tts_ms,
        generate_terms=["a", "b", "c", "d", "e"],
    )


def _parse_srt(path):
    with open(path, encoding="utf-8") as fh:
        content = fh.read()
    cues = []
    for block in content.strip().split("\n\n"):
        lines = block.split("\n")
        idx = int(lines[0])
        m = re.match(r"(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)", lines[1])
        assert m, lines[1]
        g = list(map(int, m.groups()))
        start = ((g[0] * 60 + g[1]) * 60 + g[2]) * 1000 + g[3]
        end = ((g[4] * 60 + g[5]) * 60 + g[6]) * 1000 + g[7]
        cues.append({"idx": idx, "start": start, "end": end, "text": "\n".join(lines[2:])})
    return cues


class SentenceSrtTest(unittest.TestCase):
    def test_tc_srt_01_one_beat_multiple_sentences(self):
        beat = _beat("Mở đầu đầy kịch tính. Bối cảnh dần hé lộ. Cao trào bùng nổ.", 12_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            cues = _parse_srt(p)
        self.assertEqual(3, len(cues))

    def test_tc_srt_02_continuous_no_gap_overlap(self):
        beat = _beat("Câu một rõ ràng. Câu hai rõ ràng. Câu ba rõ ràng.", 12_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            cues = _parse_srt(p)
        for a, b in zip(cues, cues[1:]):
            self.assertEqual(a["end"], b["start"])

    def test_tc_srt_03_boundary_first_start_last_end(self):
        b1 = _beat("Mở đầu câu chuyện. Diễn biến tiếp theo.", 8_000, "beat-001", 0)
        b2 = _beat("Cao trào đến gần. Kết thúc có hậu.", 8_000, "beat-002", 60_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([b1, b2], p)
            cues = _parse_srt(p)
        self.assertEqual(0, cues[0]["start"])
        self.assertEqual(8_000, cues[2]["start"])
        self.assertEqual(16_000, cues[-1]["end"])

    def test_tc_srt_04_sum_equals_tts_exactly(self):
        beat = _beat(
            "Luck ở lại chặn hậu cho đồng đội rút lui. "
            "Goran và Eric phá kết giới trong vô vọng. "
            "Cậu một mình lao vào quân đoàn ma thần.",
            12_000,
        )
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            cues = _parse_srt(p)
        total = sum(c["end"] - c["start"] for c in cues)
        self.assertEqual(12_000, total)
        # Deterministic remainder handling.
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            first_run = open(p, encoding="utf-8").read()
            p2 = os.path.join(d, "s2.srt")
            build_beat_srt([beat], p2)
            self.assertEqual(first_run, open(p2, encoding="utf-8").read())

    def test_tc_srt_05_no_cue_exceeds_80_chars(self):
        beat = _beat("Mở đầu đầy kịch tính. Bối cảnh dần hé lộ. Cao trào bùng nổ.", 12_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            cues = _parse_srt(p)
        for c in cues:
            chars = sum(len(line) for line in c["text"].split("\n"))
            self.assertLessEqual(chars, 80)

    def test_tc_srt_06_no_cue_more_than_2_lines(self):
        beat = _beat("Mở đầu đầy kịch tính của câu chuyện. Bối cảnh dần hé lộ rõ hơn.", 12_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            cues = _parse_srt(p)
        for c in cues:
            self.assertLessEqual(len(c["text"].split("\n")), 2)

    def test_tc_srt_07_cps_within_20(self):
        beat = _beat("Luck ở lại chặn hậu. Goran và Eric rút lui an toàn. Cậu lao lên.", 12_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            cues = _parse_srt(p)
        for c in cues:
            chars = sum(len(line) for line in c["text"].split("\n"))
            cps = chars / ((c["end"] - c["start"]) / 1000.0)
            self.assertLessEqual(cps, 20.0)

    def test_tc_srt_08_no_word_cut(self):
        sentences = ["Hấp Tinh Đại Pháp hút cạn sinh lực.", "Goran ôm chầm lấy cậu."]
        for s in sentences:
            wrapped = wrap_sentence_to_lines(s)
            self.assertEqual(" ".join(s.split()), " ".join(wrapped.split()))
        self.assertEqual(sentences, split_beat_sentences(" ".join(sentences)))

    def test_tc_srt_09_cta_own_cue(self):
        beat = _beat(
            "Trận chiến khép lại với chiến thắng. Cảm ơn mọi người đã xem video.",
            8_000,
        )
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            cues = _parse_srt(p)
        self.assertEqual(2, len(cues))
        self.assertIn("Cảm ơn", cues[-1]["text"])

    def test_tc_srt_10_worker_does_not_dedup(self):
        beat = _beat("Nào, hãy nói ước nguyện của ngươi. Nào, hãy nói ước nguyện của ngươi.", 8_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            cues = _parse_srt(p)
        # Worker preserves both sentences; backend-ai validator owns rejection.
        self.assertEqual(2, len(cues))

    def test_tc_srt_11_short_sentence_deterministic(self):
        beat = _beat("Đi. Ở lại chiến đấu bảo vệ đồng đội phía sau.", 6_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            build_beat_srt([beat], p)
            cues = _parse_srt(p)
            rerun = os.path.join(d, "s2.srt")
            build_beat_srt([beat], rerun)
            self.assertEqual(
                open(p, encoding="utf-8").read(), open(rerun, encoding="utf-8").read()
            )
        self.assertEqual(2, len(cues))
        self.assertEqual(0, cues[0]["start"])
        self.assertEqual(6_000, cues[-1]["end"])
        self.assertEqual(sum(c["end"] - c["start"] for c in cues), 6_000)

    def test_tc_srt_12_long_sentence_fails_no_truncate(self):
        long_sentence = " ".join(["từ"] * 60) + "."
        beat = _beat(long_sentence, 6_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            with self.assertRaises(FFmpegError):
                build_beat_srt([beat], p)

    def test_cue_over_7s_fails(self):
        beat = _beat("Một câu duy nhất kéo dài.", 12_000)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.srt")
            with self.assertRaises(FFmpegError):
                build_beat_srt([beat], p)

    def test_allocate_remainder_to_final_cue(self):
        durs = allocate_sentence_durations(["a" * 60, "b" * 40, "c" * 50], 60_000)
        self.assertEqual(60_000, sum(durs))
        # Proportional: 60/150, 40/150, 50/150 of 60000.
        self.assertEqual([24_000, 16_000, 20_000], durs)


if __name__ == "__main__":
    unittest.main()
