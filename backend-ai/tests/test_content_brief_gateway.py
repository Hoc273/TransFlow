"""Tests for generative content-brief gateway and prompt injection."""
from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.schemas.contract import ContentBriefRequest, ProviderPayload, SttSegment, Usage
from app.services import content_brief_gateway
from app.services.protocol import ChatResult


def _provider() -> ProviderPayload:
    return ProviderPayload(
        protocol="openai_compatible",
        base_url="https://provider.test/v1",
        api_key="sk-real-key",
        model="gpt-4o-mini",
    )


def _deepseek_provider() -> ProviderPayload:
    return ProviderPayload(
        protocol="dashscope_native",
        base_url="https://dashscope.test/compatible-mode/v1",
        api_key="sk-real-key",
        model="deepseek-v4.1-flash",
    )


def _qwen_omni_provider() -> ProviderPayload:
    return ProviderPayload(
        protocol="dashscope_native",
        base_url="https://dashscope.test/compatible-mode/v1",
        api_key="sk-real-key",
        model="qwen-omni-turbo",
    )


def _request() -> ContentBriefRequest:
    return ContentBriefRequest(
        correlation_id="corr-brief-1",
        media_job_id="job-brief-1",
        transcript=[
            SttSegment(text="Opening hook about the product", start_ms=0, end_ms=5_000),
            SttSegment(text="Detailed body comparison", start_ms=5_000, end_ms=40_000),
            SttSegment(text="Closing recommendation", start_ms=40_000, end_ms=55_000),
        ],
        source_lang="en",
        provider=_provider(),
    )


class ContentBriefPromptTest(unittest.TestCase):
    def test_build_content_brief_prompt_is_source_grounded(self):
        from app.core.prompts import CONTENT_BRIEF_SYSTEM, build_content_brief_prompt

        system, user = build_content_brief_prompt(
            [
                {"text": "hello", "start_ms": 0, "end_ms": 1000},
                {"text": "world", "start_ms": 1000, "end_ms": 2000},
            ],
            source_lang="vi",
        )
        self.assertIn("source-grounded", system.lower())
        self.assertIn("Do not select footage", system)
        self.assertIn(CONTENT_BRIEF_SYSTEM[:40], system)
        self.assertIn("<source_lang>vi</source_lang>", user)
        self.assertIn('<seg start_ms="0" end_ms="1000">hello</seg>', user)
        self.assertIn("<transcript>", user)


class ContentBriefGatewayTest(unittest.IsolatedAsyncioTestCase):
    async def test_mock_mode_returns_brief(self):
        with patch.object(content_brief_gateway.settings, "mock_mode", True):
            result = await content_brief_gateway.understand_brief(_request())
        self.assertEqual(result.status, "COMPLETED")
        self.assertIsNotNone(result.content_brief)
        self.assertIn("product", result.content_brief.lower())

    async def test_empty_transcript_raises_validation(self):
        req = ContentBriefRequest(
            correlation_id="corr-empty",
            media_job_id="job-empty",
            transcript=[],
            source_lang="en",
            provider=_provider(),
        )
        with self.assertRaises(Exception) as ctx:
            await content_brief_gateway.understand_brief(req)
        self.assertIn("non-empty transcript", str(ctx.exception))

    async def test_llm_path_returns_usage(self):
        chat_result = ChatResult(
            text="This review covers a product from opening to closing recommendation.",
            usage=Usage(
                input_tokens=100,
                output_tokens=40,
                provider="openai_compatible",
                model="gpt-4o-mini",
            ),
        )
        with (
            patch.object(content_brief_gateway.settings, "mock_mode", False),
            patch(
                "app.core.config.Settings.key_is_usable",
                return_value=True,
            ),
            patch(
                "app.services.content_brief_gateway.chat",
                new=AsyncMock(return_value=chat_result),
            ) as chat_mock,
        ):
            result = await content_brief_gateway.understand_brief(_request())
        self.assertEqual(result.status, "COMPLETED")
        self.assertEqual(
            result.content_brief,
            "This review covers a product from opening to closing recommendation.",
        )
        self.assertEqual(result.usage.input_tokens, 100)
        chat_mock.assert_awaited_once()

    async def test_deepseek_dashscope_uses_normalized_reasoning_control(self):
        req = _request()
        req.provider = _deepseek_provider()
        chat_result = ChatResult(
            text="A source-grounded product review brief.",
            usage=Usage(
                input_tokens=10,
                output_tokens=5,
                provider="dashscope_native",
                model="deepseek-v4.1-flash",
            ),
        )
        with (
            patch.object(content_brief_gateway.settings, "mock_mode", False),
            patch.object(content_brief_gateway, "chat", AsyncMock(return_value=chat_result)) as chat_mock,
        ):
            result = await content_brief_gateway.understand_brief(req)

        self.assertEqual("COMPLETED", result.status)
        self.assertEqual("A source-grounded product review brief.", result.content_brief)
        self.assertEqual(
            {"enable_thinking": False},
            chat_mock.await_args.kwargs["extra_body"],
        )

    async def test_deepseek_dashscope_reasoning_content_response_succeeds(self):
        captured: dict = {}

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                captured.update(kwargs)
                return httpx.Response(200, json={
                    "choices": [{"message": {
                        "content": "",
                        "reasoning_content": "A source-grounded DeepSeek brief.",
                    }, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                })

        req = _request()
        req.provider = _deepseek_provider()
        with (
            patch.object(content_brief_gateway.settings, "mock_mode", False),
            patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()),
        ):
            result = await content_brief_gateway.understand_brief(req)

        self.assertEqual("COMPLETED", result.status)
        self.assertEqual("A source-grounded DeepSeek brief.", result.content_brief)
        self.assertEqual(False, captured["json"]["enable_thinking"])

    async def test_qwen_omni_brief_retries_without_unsupported_reasoning_control(self):
        calls: list[dict] = []

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                calls.append(kwargs["json"])
                if len(calls) == 1:
                    return httpx.Response(400, json={
                        "code": "InvalidParameter",
                        "message": "qwen-omni-turbo does not support enable_thinking",
                    })
                return httpx.Response(200, json={
                    "choices": [{"message": {
                        "content": "A source-grounded Qwen brief.",
                    }, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                })

        req = _request()
        req.provider = _qwen_omni_provider()
        with (
            patch.object(content_brief_gateway.settings, "mock_mode", False),
            patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()),
        ):
            result = await content_brief_gateway.understand_brief(req)

        self.assertEqual("COMPLETED", result.status)
        self.assertEqual("A source-grounded Qwen brief.", result.content_brief)
        self.assertEqual(2, len(calls))
        self.assertEqual(False, calls[0]["enable_thinking"])
        self.assertNotIn("enable_thinking", calls[1])

    async def test_gateway_contract_shape_completed(self):
        with patch.object(content_brief_gateway.settings, "mock_mode", True):
            response = await content_brief_gateway.understand_brief(_request())
        self.assertEqual(response.status, "COMPLETED")
        self.assertTrue(response.content_brief)
        self.assertEqual(response.correlation_id, "corr-brief-1")


if __name__ == "__main__":
    unittest.main()
