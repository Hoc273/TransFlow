"""Tests for the structured-output JSON extraction helper."""
from __future__ import annotations

import unittest

from app.api.structured import parse_json_object


class ParseJsonObjectTest(unittest.TestCase):

    def test_clean_json(self):
        obj = parse_json_object('{"a": 1, "b": [2, 3]}')
        self.assertEqual({"a": 1, "b": [2, 3]}, obj)

    def test_prefers_dict_with_list_value(self):
        """If reasoning prose contains a small dict first, skip it and prefer the proposals dict."""
        text = (
            'Here is my plan: {"step": "think harder"} and then the answer '
            '{"proposals": [{"proposal_index": 1, "cut_ranges": [{"start_ms": 0, "end_ms": 1000}]}]}'
        )
        obj = parse_json_object(text)
        self.assertIn("proposals", obj)
        self.assertEqual(1, len(obj["proposals"]))

    def test_falls_back_to_first_valid_dict(self):
        text = 'Let me check {"foo": "bar"} carefully. That is it.'
        obj = parse_json_object(text)
        self.assertEqual({"foo": "bar"}, obj)

    def test_strips_code_fence(self):
        text = "```json\n{\"proposals\": [1, 2, 3]}\n```"
        obj = parse_json_object(text)
        self.assertEqual({"proposals": [1, 2, 3]}, obj)

    def test_no_json_raises(self):
        with self.assertRaises(ValueError):
            parse_json_object("Sorry, I cannot help.")

    def test_embedded_json_in_long_prose(self):
        """Regression for DeepSeek V4 reasoning: long prose then JSON at the end."""
        prose = "I need to think about this carefully. " * 50
        text = prose + '{"proposals": [{"proposal_index": 1}], "extra": "tail"}'
        obj = parse_json_object(text)
        self.assertIn("proposals", obj)
        self.assertEqual(1, obj["proposals"][0]["proposal_index"])

    def test_balanced_braces_inside_strings_do_not_confuse_parser(self):
        text = '{"reasoning": "open { close }", "proposals": [1, 2]}'
        obj = parse_json_object(text)
        self.assertIn("proposals", obj)
        self.assertEqual("open { close }", obj["reasoning"])


if __name__ == "__main__":
    unittest.main()