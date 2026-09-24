"""Tests for the /ai/translate route — JSON-mode parity with /media/summarize.

Covers:
  * content empty + reasoning_content carries JSON  -> COMPLETED
  * content empty + reasoning_content is prose       -> FAILED
  * finish_reason=length                              -> FAILED with truncation message
  * response_format={"type":"json_object"} forwarded to adapter
  * extra_body={"thinking":{"type":"disabled"}} forwarded when setting on
  * extra_body=None when setting off
  * max_tokens from settings.translate_max_tokens
"""
from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.api import routes
from app.schemas.contract import ProviderPayload, QARequest, TranslateRequest, Usage, ValidateProviderRequest
from app.services.protocol import ChatResult
from app.services.provider_errors import ProviderErrorCode, ProviderException


def _provider() -> ProviderPayload:
    return ProviderPayload(
        protocol="openai_compatible",
        base_url="https://provider.test/v1",
        api_key="sk-real-key",
        model="gpt-4o-mini",
    )


def _request() -> TranslateRequest:
    return TranslateRequest(
        request_id="req-1",
        workspace_id="ws-1",
        source_lang="en",
        target_lang="vi",
        source_text="Hello world",
        provider=_provider(),
    )


def _deepseek_request() -> TranslateRequest:
    req = _request()
    req.provider = ProviderPayload(
        protocol="dashscope_native",
        base_url="https://dashscope.test/compatible-mode/v1",
        api_key="sk-real-key",
        model="deepseek-v4.1-flash",
    )
    return req


def _qwen_omni_request() -> TranslateRequest:
    req = _request()
    req.provider = ProviderPayload(
        protocol="dashscope_native",
        base_url="https://dashscope.test/compatible-mode/v1",
        api_key="sk-real-key",
        model="qwen-omni-turbo",
    )
    return req


def _usage() -> Usage:
    return Usage(input_tokens=10, output_tokens=20, provider="openai_compatible", model="gpt-4o-mini")


def _chat_result(text: str, finish_reason: str = "stop") -> ChatResult:
    return ChatResult(text=text, usage=_usage(), finish_reason=finish_reason)


async def _translate_sse_done(req: TranslateRequest) -> dict:
    events = [event async for event in routes._translate_stream(req, "system", "user")]
    done = next(event for event in events if event.startswith("event: done\n"))
    data = done.split("data: ", 1)[1].strip()
    return json.loads(data)


class TranslateJsonModeTest(unittest.IsolatedAsyncioTestCase):
    """Parity with summarize: response_format + extra_body + max_tokens."""

    async def _run_translate(self, chat_result: ChatResult):
        with patch.object(routes.llm_gateway, "chat", AsyncMock(return_value=chat_result)) as mock_chat:
            response = await routes.translate(_request())
            return response, mock_chat

    async def test_content_empty_reasoning_json_returns_completed(self):
        """DeepSeek V4 pattern: content empty, reasoning_content holds the JSON."""
        reasoning_json = json.dumps({"translation": "Xin chào thế giới", "applied_glossary": []})
        result = ChatResult(text=reasoning_json, usage=_usage(), finish_reason="stop")
        response, _ = await self._run_translate(result)
        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(response.translation, "Xin chào thế giới")

    async def test_content_empty_reasoning_prose_returns_failed(self):
        """reasoning_content is chain-of-thought prose, not JSON."""
        prose = "I need to translate 'Hello world' from English to Vietnamese. " \
                "The translation is straightforward..."
        result = ChatResult(text=prose, usage=_usage(), finish_reason="stop")
        response, _ = await self._run_translate(result)
        self.assertEqual(response.status, "FAILED")
        self.assertIn("non-JSON", response.error)

    async def test_finish_reason_length_returns_truncation_error(self):
        """finish_reason=length must surface as 'truncated', not 'non-JSON'."""
        result = ChatResult(text="", usage=_usage(), finish_reason="length")
        response, _ = await self._run_translate(result)
        self.assertEqual(response.status, "FAILED")
        self.assertIn("truncated", response.error.lower())
        self.assertIn("finish_reason=length", response.error)

    async def test_empty_output_returns_empty_error(self):
        """Both content and reasoning_content empty."""
        result = ChatResult(text="", usage=_usage(), finish_reason="stop")
        response, _ = await self._run_translate(result)
        self.assertEqual(response.status, "FAILED")
        self.assertIn("empty", response.error.lower())

    async def test_provider_exception_is_returned_with_typed_error_detail(self):
        failure = ProviderException(
            ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED,
            "Provider quota has been exhausted",
            protocol="dashscope_native",
            capability="TEXT",
            model="qwen-plus",
            details={"vendorStatus": "403", "vendorCode": "AllocationQuota.FreeTierOnly"},
        )
        with patch.object(routes.llm_gateway, "chat", AsyncMock(side_effect=failure)):
            response = await routes.translate(_deepseek_request())

        self.assertEqual("FAILED", response.status)
        self.assertEqual("PROVIDER_QUOTA_EXCEEDED", response.error_detail.errorCode)
        self.assertEqual("Provider quota has been exhausted", response.error_detail.message)
        self.assertEqual("qwen-plus", response.error_detail.model)
        self.assertEqual("TEXT", response.error_detail.capability)
        self.assertNotIn("AllocationQuota", response.error)

    async def test_null_translation_json_returns_validation_error(self):
        response, _ = await self._run_translate(_chat_result('{"translation": null}'))
        self.assertEqual(response.status, "FAILED")
        self.assertIn("empty translation", response.error.lower())

    async def test_blank_translation_json_returns_validation_error(self):
        response, _ = await self._run_translate(_chat_result('{"translation": "   "}'))
        self.assertEqual(response.status, "FAILED")
        self.assertIn("empty translation", response.error.lower())

    async def test_response_format_json_object_forwarded(self):
        """The route must pass response_format={'type': 'json_object'} to the gateway."""
        result = _chat_result('{"translation": "text", "applied_glossary": []}')
        _, mock_chat = await self._run_translate(result)
        _args, kwargs = mock_chat.call_args
        self.assertEqual(kwargs.get("response_format"), {"type": "json_object"})

    async def test_thinking_disabled_forwarded_when_setting_on(self):
        """extra_body must contain thinking=disabled when setting is True."""
        with patch.object(routes.settings, "disable_thinking_for_translate", True):
            result = _chat_result('{"translation": "text", "applied_glossary": []}')
            _, mock_chat = await self._run_translate(result)
        _args, kwargs = mock_chat.call_args
        self.assertEqual(kwargs.get("extra_body"), {"thinking": {"type": "disabled"}})

    async def test_thinking_disabled_omitted_when_setting_off(self):
        """extra_body must be None when setting is False."""
        with patch.object(routes.settings, "disable_thinking_for_translate", False):
            result = _chat_result('{"translation": "text", "applied_glossary": []}')
            _, mock_chat = await self._run_translate(result)
        _args, kwargs = mock_chat.call_args
        self.assertIsNone(kwargs.get("extra_body"))

    async def test_max_tokens_from_settings(self):
        """The route must use settings.translate_max_tokens, not the gateway default."""
        with patch.object(routes.settings, "translate_max_tokens", 4096):
            result = _chat_result('{"translation": "text", "applied_glossary": []}')
            _, mock_chat = await self._run_translate(result)
        _args, kwargs = mock_chat.call_args
        self.assertEqual(kwargs.get("max_tokens"), 4096)

    async def test_provider_text_probe_uses_configured_model_and_safe_message(self):
        provider = _deepseek_request().provider
        with patch.object(routes.llm_gateway, "chat", AsyncMock(return_value=_chat_result("OK secret-free"))) as mock_chat:
            response = await routes.validate_provider(ValidateProviderRequest(provider=provider))

        self.assertTrue(response.ok)
        self.assertEqual("deepseek-v4.1-flash", response.model)
        self.assertEqual("Text capability probe successful", response.message)
        self.assertEqual("deepseek-v4.1-flash", mock_chat.call_args.args[0].model)

    async def test_provider_text_probe_empty_output_is_typed_failure(self):
        provider = _deepseek_request().provider
        with patch.object(routes.llm_gateway, "chat", AsyncMock(return_value=_chat_result(""))):
            response = await routes.validate_provider(ValidateProviderRequest(provider=provider))

        self.assertFalse(response.ok)
        self.assertEqual("PROVIDER_EMPTY_RESPONSE", response.error_detail.errorCode)
        self.assertEqual("deepseek-v4.1-flash", response.error_detail.model)

    async def test_deepseek_dashscope_translation_uses_normalized_reasoning_control(self):
        captured: dict = {}

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                captured.update(kwargs)
                return httpx.Response(200, json={
                    "choices": [{"message": {"content": json.dumps({
                        "translation": "Xin chao the gioi",
                        "applied_glossary": [],
                    })}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                })

        with (
            patch.object(routes.settings, "mock_mode", False),
            patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()),
        ):
            response = await routes.translate(_deepseek_request())

        self.assertEqual("COMPLETED", response.status)
        self.assertEqual("Xin chao the gioi", response.translation)
        self.assertEqual(False, captured["json"]["enable_thinking"])
        self.assertNotIn("thinking", captured["json"])

    async def test_deepseek_dashscope_reasoning_json_translation_fallback(self):
        reasoning_json = json.dumps({
            "translation": "Xin chao the gioi",
            "applied_glossary": [],
        })

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                return httpx.Response(200, json={
                    "choices": [{"message": {
                        "content": "",
                        "reasoning_content": reasoning_json,
                    }, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                })

        with (
            patch.object(routes.settings, "mock_mode", False),
            patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()),
        ):
            response = await routes.translate(_deepseek_request())

        self.assertEqual("COMPLETED", response.status)
        self.assertEqual("Xin chao the gioi", response.translation)

    async def test_qwen_omni_translation_retries_without_unsupported_reasoning_control(self):
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
                    "choices": [{"message": {"content": json.dumps({
                        "translation": "Xin chao the gioi",
                        "applied_glossary": [],
                    })}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                })

        with (
            patch.object(routes.settings, "mock_mode", False),
            patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()),
        ):
            response = await routes.translate(_qwen_omni_request())

        self.assertEqual("COMPLETED", response.status)
        self.assertEqual("Xin chao the gioi", response.translation)
        self.assertEqual(2, len(calls))
        self.assertEqual(False, calls[0]["enable_thinking"])
        self.assertNotIn("enable_thinking", calls[1])

    async def test_qa_uses_same_dashscope_reasoning_control(self):
        req = QARequest(
            request_id="qa-1",
            source_lang="en",
            target_lang="vi",
            source_text="Hello world",
            translated_text="Xin chao the gioi",
            provider=_deepseek_request().provider,
            checks=[],
        )
        result = ChatResult(
            text='{"issues":[],"score":1.0}',
            usage=_usage(),
            finish_reason="stop",
        )
        with patch.object(routes.llm_gateway, "chat", AsyncMock(return_value=result)) as mock_chat:
            response = await routes.qa(req)

        self.assertEqual("COMPLETED", response.status)
        self.assertEqual(
            {"enable_thinking": False},
            mock_chat.await_args.kwargs["extra_body"],
        )

    async def test_qa_accepts_current_blocking_actions(self):
        req = QARequest(
            request_id="qa-actions",
            source_lang="en",
            target_lang="vi",
            source_text="Hello world",
            translated_text="Xin chao the gioi",
            provider=_deepseek_request().provider,
            checks=[],
        )
        result = ChatResult(
            text='{"issues":[{"type":"accuracy","message":"Sai nghĩa","blocking_actions":["BLOCK_APPROVAL","BLOCK_PUBLISH","BLOCK_RENDER"]}]}',
            usage=_usage(),
            finish_reason="stop",
        )
        with patch.object(routes.llm_gateway, "chat", AsyncMock(return_value=result)):
            response = await routes.qa(req)

        self.assertEqual("COMPLETED", response.status)
        self.assertEqual(["BLOCK_APPROVAL", "BLOCK_PUBLISH", "BLOCK_RENDER"],
                         response.issues[0].blocking_actions)


class TranslateClassificationTest(unittest.TestCase):
    """Unit tests for _classify_text_failure."""

    def test_length_returns_truncation_message(self):
        msg, code = routes._classify_text_failure("", "length")
        self.assertIn("truncated", msg.lower())
        self.assertIn("finish_reason=length", msg)
        self.assertEqual(code, "PROVIDER_RESPONSE_MALFORMED")

    def test_empty_output_returns_empty_message(self):
        msg, code = routes._classify_text_failure("", "stop")
        self.assertIn("empty", msg.lower())
        self.assertEqual(code, "PROVIDER_EMPTY_RESPONSE")

    def test_non_json_returns_malformed_message(self):
        msg, code = routes._classify_text_failure("some prose without json", "stop")
        self.assertIn("non-JSON", msg)
        self.assertEqual(code, "PROVIDER_RESPONSE_MALFORMED")


class TranslateStreamingFailureTest(unittest.IsolatedAsyncioTestCase):
    async def test_non_json_stream_returns_typed_failure(self):
        with patch.object(routes.llm_gateway, "chat", AsyncMock(return_value=_chat_result("not JSON"))):
            response = await _translate_sse_done(_request())

        self.assertEqual("FAILED", response["status"])
        self.assertEqual("PROVIDER_RESPONSE_MALFORMED", response["error_detail"]["errorCode"])
        self.assertEqual("gpt-4o-mini", response["error_detail"]["model"])

    async def test_length_stream_returns_typed_malformed_failure(self):
        with patch.object(routes.llm_gateway, "chat", AsyncMock(return_value=_chat_result("", "length"))):
            response = await _translate_sse_done(_request())

        self.assertEqual("FAILED", response["status"])
        self.assertEqual("PROVIDER_RESPONSE_MALFORMED", response["error_detail"]["errorCode"])

    async def test_empty_translation_stream_returns_typed_empty_failure(self):
        with patch.object(
            routes.llm_gateway, "chat",
            AsyncMock(return_value=_chat_result('{"translation": "   "}')),
        ):
            response = await _translate_sse_done(_request())

        self.assertEqual("FAILED", response["status"])
        self.assertEqual("PROVIDER_EMPTY_RESPONSE", response["error_detail"]["errorCode"])
        self.assertEqual("gpt-4o-mini", response["error_detail"]["model"])

    async def test_provider_exception_stream_preserves_provider_error_detail(self):
        failure = ProviderException(
            ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED,
            "Provider quota has been exhausted",
            protocol="dashscope_native",
            capability="TEXT",
            model="qwen-plus",
        )
        req = _deepseek_request()
        req.provider.model = "qwen-plus"
        with patch.object(routes.llm_gateway, "chat", AsyncMock(side_effect=failure)):
            response = await _translate_sse_done(req)

        self.assertEqual("FAILED", response["status"])
        self.assertEqual("PROVIDER_QUOTA_EXCEEDED", response["error_detail"]["errorCode"])
        self.assertEqual("qwen-plus", response["error_detail"]["model"])
        self.assertFalse(response["error_detail"]["retryable"])


if __name__ == "__main__":
    unittest.main()
