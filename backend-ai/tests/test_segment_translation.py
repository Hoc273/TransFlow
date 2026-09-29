"""/ai/translate with ``segments`` keeps subtitle lines one-to-one."""
from __future__ import annotations

import asyncio
import json
import re
import unittest
from unittest.mock import patch

from app.schemas.contract import ProviderPayload, TranslateRequest, Usage
from app.api import routes
from app.services import segment_translation
from app.services.llm_gateway import ChatResult
from app.services.provider_errors import ProviderErrorCode, ProviderException


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

    async def test_batches_run_concurrently_and_keep_line_order(self):
        texts = [f"line {i} " + "x" * 200 for i in range(40)]  # several batches
        in_flight = 0
        peak = 0

        async def fake_chat(provider, system, user, **kwargs):
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0.01)
            in_flight -= 1
            lines = dict(re.findall(r'<line id="(\d+)">line (\d+) ', user))
            return ChatResult(text=json.dumps({k: f"T{v}" for k, v in lines.items()}),
                              usage=Usage(input_tokens=1, output_tokens=1))

        with patch.object(segment_translation.settings, "mock_mode", False),                 patch.object(segment_translation.settings, "translate_batch_concurrency", 2),                 patch.object(type(segment_translation.settings), "key_is_usable", lambda self, key: True),                 patch.object(segment_translation.llm_gateway, "chat", fake_chat):
            response = await segment_translation.translate_segments(_request(texts))

        self.assertEqual(2, peak)
        self.assertEqual([f"T{i}" for i in range(40)], [s.translation for s in response.segments])

    async def test_failed_batch_cancels_batches_still_running(self):
        texts = [f"line {i} " + "x" * 200 for i in range(40)]
        cancelled = 0
        calls = 0

        async def fake_chat(provider, system, user, **kwargs):
            nonlocal cancelled, calls
            calls += 1
            if calls == 1:
                raise ProviderException(ProviderErrorCode.PROVIDER_INTERNAL_ERROR, "upstream 502")
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled += 1
                raise
            return ChatResult(text="{}")

        with patch.object(segment_translation.settings, "mock_mode", False),                 patch.object(segment_translation.settings, "translate_batch_concurrency", 2),                 patch.object(type(segment_translation.settings), "key_is_usable", lambda self, key: True),                 patch.object(segment_translation.llm_gateway, "chat", fake_chat):
            with self.assertRaises(ProviderException):
                await segment_translation.translate_segments(_request(texts))

        # Every batch that got started besides the failed one was cancelled, none finished.
        self.assertGreaterEqual(calls, 2)
        self.assertEqual(calls - 1, cancelled)

    async def test_route_returns_retryable_timeout_when_budget_is_exceeded(self):
        async def slow_translate(req):
            await asyncio.sleep(10)

        with patch.object(routes.settings, "translate_time_budget_seconds", 0.05),                 patch.object(routes, "translate_segments", slow_translate):
            response = await routes.translate(_request(["一"]))

        self.assertEqual("FAILED", response.status)
        self.assertEqual("PROVIDER_TIMEOUT", response.error_detail.errorCode)
        self.assertTrue(response.error_detail.retryable)

    def test_batches_respect_line_and_char_limits(self):
        lines = [(i, "x" * 200) for i in range(40)]
        batches = segment_translation._batches(lines)
        self.assertTrue(all(len(b) <= segment_translation.MAX_BATCH_LINES for b in batches))
        self.assertTrue(all(sum(len(t) for _, t in b) <= segment_translation.MAX_BATCH_CHARS for b in batches))
        self.assertEqual(40, sum(len(b) for b in batches))


if __name__ == "__main__":
    unittest.main()
