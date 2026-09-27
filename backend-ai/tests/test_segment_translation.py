"""/ai/translate with ``segments`` keeps subtitle lines one-to-one."""
from __future__ import annotations

import json
import re
import unittest
from unittest.mock import patch

from app.schemas.contract import ProviderPayload, TranslateRequest, Usage
from app.services import segment_translation
from app.services.llm_gateway import ChatResult


def _request(texts: list[str]) -> TranslateRequest:
    return TranslateRequest(
        request_id="r1",
        source_lang="zh",
        target_lang="en",
        source_text=" ".join(texts),
        provider=ProviderPayload(
            protocol="openai_compatible", base_url="https://llm.test/v1",
            api_key="sk-live-key-123456", model="any-model", capabilities=["TEXT"],
        ),
        segments=[{"id": f"seg-{i}", "text": text} for i, text in enumerate(texts)],
    )


def _ids(user: str) -> list[str]:
    return re.findall(r'<line id="(\d+)">', user)


class SegmentTranslationTest(unittest.IsolatedAsyncioTestCase):
    async def _run(self, texts, reply):
        calls: list[str] = []

        async def fake_chat(provider, system, user, **kwargs):
            calls.append(user)
            return ChatResult(text=reply(user, len(calls)), usage=Usage(input_tokens=10, output_tokens=5))

        with patch.object(segment_translation.settings, "mock_mode", False), \
                patch.object(type(segment_translation.settings), "key_is_usable", lambda self, key: True), \
                patch.object(segment_translation.llm_gateway, "chat", fake_chat):
            response = await segment_translation.translate_segments(_request(texts))
        return response, calls

    async def test_cjk_lines_stay_one_to_one(self):
        texts = ["黑市有动静。", "哇，副官呢？", "真的假的？"]

        def reply(user, _):
            return json.dumps({"translations": [
                {"id": key, "translation": f"EN-{key}"} for key in _ids(user)]})

        response, calls = await self._run(texts, reply)
        self.assertEqual("COMPLETED", response.status)
        self.assertEqual(["seg-0", "seg-1", "seg-2"], [s.id for s in response.segments])
        self.assertEqual(["EN-1", "EN-2", "EN-3"], [s.translation for s in response.segments])
        self.assertEqual(1, len(calls))
        self.assertEqual(10, response.usage.input_tokens)

    async def test_dropped_lines_are_retried_until_every_line_has_text(self):
        texts = ["一", "二", "三", "四"]

        def reply(user, call):
            ids = _ids(user)
            if call == 1:  # model skips half the batch
                return json.dumps({"translations": [{"id": ids[0], "translation": "one"}]})
            if ids:
                return json.dumps({str(k): f"line-{k}" for k in ids})  # bare map shape
            return json.dumps({"translation": "single"})

        response, _ = await self._run(texts, reply)
        self.assertTrue(all(s.translation for s in response.segments))
        self.assertEqual("one", response.segments[0].translation)

    async def test_single_line_fallback_when_batches_fail(self):
        def reply(user, _):
            return "not json" if _ids(user) else json.dumps({"translation": "fallback"})

        response, _ = await self._run(["一", "二"], reply)
        self.assertEqual(["fallback", "fallback"], [s.translation for s in response.segments])

    def test_batches_respect_line_and_char_limits(self):
        lines = [(i, "x" * 200) for i in range(40)]
        batches = segment_translation._batches(lines)
        self.assertTrue(all(len(b) <= segment_translation.MAX_BATCH_LINES for b in batches))
        self.assertTrue(all(sum(len(t) for _, t in b) <= segment_translation.MAX_BATCH_CHARS for b in batches))
        self.assertEqual(40, sum(len(b) for b in batches))


if __name__ == "__main__":
    unittest.main()
