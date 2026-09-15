"""Sentence splitter unit tests (Generative Sentence-Level SRT, Option A)."""
from __future__ import annotations

import unittest

from app.services.sentence_splitter import split_sentences


class SentenceSplitterTest(unittest.TestCase):
    def test_normal_vietnamese_sentences(self):
        text = "Luck một mình lao vào quân đoàn ma thần. Goran ôm chầm lấy cậu. Eric rơi nước mắt."
        out = split_sentences(text)
        self.assertEqual(3, len(out))
        self.assertTrue(out[0].endswith("."))
        self.assertIn("Luck", out[0])

    def test_exclamation_question_ellipsis(self):
        out = split_sentences("Nguy hiểm quá! Ai sẽ ở lại? Cậu im lặng… Rồi lao lên.")
        self.assertEqual(4, len(out))
        self.assertTrue(out[0].endswith("!"))
        self.assertTrue(out[1].endswith("?"))
        self.assertTrue(out[2].endswith("…"))

    def test_multiple_whitespace_newlines(self):
        out = split_sentences("Câu một.   \n\n  Câu hai!\nCâu ba?")
        self.assertEqual(["Câu một.", "Câu hai!", "Câu ba?"], out)

    def test_abbreviation_and_decimal_not_split(self):
        out = split_sentences("Gặp Dr. Goran lúc 3.5 giờ. Ông rất vui.")
        self.assertEqual(2, len(out))
        self.assertIn("3.5", out[0])

    def test_quoted_text(self):
        out = split_sentences('Cậu nói "Hãy để mọi chuyện cho mình." Rồi cậu ở lại.')
        self.assertEqual(2, len(out))
        self.assertIn("Hãy để mọi chuyện cho mình.", out[0])

    def test_very_short_sentence(self):
        out = split_sentences("Đi. Ở lại chiến đấu.")
        self.assertEqual(["Đi.", "Ở lại chiến đấu."], out)

    def test_long_sentence_preserved_whole(self):
        long_s = "Sau chuỗi trận chiến liên tiếp đầy thương tích mà không hề có lấy một lần nghỉ ngơi, cả ba hiểu rằng đối đầu trực diện chắc chắn sẽ chết."
        out = split_sentences(long_s)
        self.assertEqual(1, len(out))
        self.assertEqual(long_s, out[0])

    def test_empty_input(self):
        self.assertEqual([], split_sentences(""))
        self.assertEqual([], split_sentences("   \n  "))
        self.assertEqual([], split_sentences(None))

    def test_one_paragraph_narration(self):
        text = (
            "Luck bảo Eric và Goran hãy để mọi chuyện ở đây cho mình. "
            "Cả hai lập tức từ chối vì không thể bỏ mặc đồng đội. "
            "Cậu nhắc rằng Ma Thần Vương vẫn chưa bị đánh bại nên Eric tuyệt đối không được chết ở đây."
        )
        out = split_sentences(text)
        self.assertEqual(3, len(out))
        # Deterministic: same input always same output.
        self.assertEqual(out, split_sentences(text))

    def test_cjk_sentences(self):
        text = "云南菜未能列入八大菜系，并非因为实力不足，而是现有的框架根本无法容纳它的丰富。这片土地拥有二十六个民族和一百多种可食用野生菌！你说，我们要用哪一道菜来代表这一切？"
        out = split_sentences(text)
        self.assertEqual(3, len(out))
        self.assertTrue(out[0].endswith("。"))
        self.assertTrue(out[1].endswith("！"))
        self.assertTrue(out[2].endswith("？"))


if __name__ == "__main__":
    unittest.main()
