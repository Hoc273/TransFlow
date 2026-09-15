"""Tests for the wire-level DEBUG dump mode (DEBUG_LLM_WIRE).

These tests verify that when ``settings.debug_llm_wire`` is True, the
OpenAI-compatible chat adapter emits:
  * WIRE_REQUEST — full request payload + headers (api key redacted)
  * WIRE_RESPONSE — full raw response body + parsed fields

When the flag is False (default), neither record is emitted.
"""
from __future__ import annotations

import json
import logging
import unittest
from unittest.mock import patch

import httpx


def _make_response(payload: dict) -> httpx.Response:
    return httpx.Response(200, json=payload)


def _client_with_response(payload: dict):
    response = _make_response(payload)

    class _Client:
        def __init__(self):
            self.calls = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kwargs):
            self.calls.append({"url": url, **kwargs})
            return response

    return _Client()


def _provider():
    from app.schemas.contract import ProviderPayload

    return ProviderPayload(
        protocol="openai_compatible",
        base_url="https://provider.test/v1",
        api_key="sk-real-secret-key-1234567890",
        model="deepseek-v4-flash-free",
    )


def _attach_capture_handler() -> tuple[logging.Handler, list[logging.LogRecord]]:
    captured: list[logging.LogRecord] = []

    class _CaptureHandler(logging.Handler):
        def emit(self, record):
            captured.append(record)

    handler = _CaptureHandler()
    debug_logger = logging.getLogger("transflow.ai.debug.openai_compatible.chat")
    debug_logger.addHandler(handler)
    debug_logger.setLevel(logging.DEBUG)
    return handler, captured


def _detach_capture_handler(handler: logging.Handler) -> None:
    debug_logger = logging.getLogger("transflow.ai.debug.openai_compatible.chat")
    debug_logger.removeHandler(handler)


def _reset_debug_log() -> None:
    import app.services.protocol.openai_compatible as mod
    mod._debug_log = None


class DebugFlagOffTest(unittest.IsolatedAsyncioTestCase):
    """Default behavior: no debug dumps at all."""

    async def test_no_debug_log_when_flag_off(self):
        from app.services.protocol.openai_compatible import OpenAICompatibleAdapter

        payload = {"choices": [{"message": {"content": "OK"}}],
                   "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
        client = _client_with_response(payload)

        handler, captured = _attach_capture_handler()
        try:
            with patch("app.services.protocol.openai_compatible.httpx.AsyncClient",
                       return_value=client):
                with patch("app.core.config.settings.debug_llm_wire", False):
                    result = await OpenAICompatibleAdapter().chat(
                        _provider(), system="sys", user="hi",
                        extra_body={"thinking": {"type": "disabled"}},
                    )
        finally:
            _detach_capture_handler(handler)

        # Result is unaffected by debug mode.
        self.assertEqual(result.text, "OK")
        # No WIRE_REQUEST / WIRE_RESPONSE emitted when flag is off.
        self.assertEqual([r for r in captured if "WIRE_" in r.getMessage()], [])


class DebugFlagOnTest(unittest.IsolatedAsyncioTestCase):
    """DEBUG_LLM_WIRE=true: log full wire dump."""

    async def _run_with_capture(self, provider_payload: dict, status_code: int = 200,
                                 body_text: str | None = None,
                                 content_type: str | None = None):
        from app.services.protocol.openai_compatible import OpenAICompatibleAdapter

        _reset_debug_log()

        if body_text is not None:
            kwargs = {}
            if content_type:
                kwargs["headers"] = {"content-type": content_type}
            response = httpx.Response(status_code, text=body_text, **kwargs)
        else:
            response = _make_response(provider_payload)

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                return response

        handler, captured = _attach_capture_handler()
        try:
            with patch("app.services.protocol.openai_compatible.httpx.AsyncClient",
                       return_value=_Client()):
                with patch("app.core.config.settings.debug_llm_wire", True):
                    try:
                        await OpenAICompatibleAdapter().chat(
                            _provider(), system="sys", user="hi",
                            max_tokens=8192,
                            extra_body={"thinking": {"type": "disabled"}},
                        )
                    except Exception:
                        pass  # ProviderException from 4xx/5xx is fine — we only care about debug logs.
        finally:
            _detach_capture_handler(handler)
            _reset_debug_log()
        return captured

    async def test_request_dump_records_full_payload(self):
        captured = await self._run_with_capture(
            {"choices": [{"message": {"content": "OK"}}],
             "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
        )

        wire_request_records = [r for r in captured if "WIRE_REQUEST" in r.getMessage()]
        self.assertEqual(len(wire_request_records), 1)
        rec = wire_request_records[0]
        self.assertIn("wireRequest", rec.__dict__)
        wire = rec.__dict__["wireRequest"]
        self.assertEqual(wire["model"], "deepseek-v4-flash-free")
        self.assertEqual(wire["thinking"], {"type": "disabled"})
        # response_format is None when caller doesn't pass it; in that case the
        # field is absent from the payload — that's correct behavior.
        self.assertNotIn("response_format", wire)
        self.assertEqual(wire["max_tokens"], 8192)
        self.assertEqual(wire["messages"][0]["role"], "system")
        self.assertEqual(wire["messages"][1]["content"], "hi")

    async def test_request_dump_redacts_api_key(self):
        captured = await self._run_with_capture(
            {"choices": [{"message": {"content": "OK"}}],
             "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
        )

        wire_request_records = [r for r in captured if "WIRE_REQUEST" in r.getMessage()]
        self.assertEqual(len(wire_request_records), 1)
        headers = wire_request_records[0].__dict__["wireRequestHeaders"]
        self.assertIn("Authorization", headers)
        self.assertNotIn("sk-real-secret-key-1234567890", headers["Authorization"])
        self.assertTrue(headers["Authorization"].startswith("Bearer "))

    async def test_response_dump_records_full_raw_body(self):
        deepseek_like_payload = {
            "id": "chatcmpl-abc",
            "object": "chat.completion",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "",
                    "reasoning_content": "We need to think hard...",
                },
                "finish_reason": "length",
            }],
            "usage": {
                "prompt_tokens": 1234,
                "completion_tokens": 4096,
                "total_tokens": 5330,
            },
        }

        captured = await self._run_with_capture(deepseek_like_payload)

        wire_response_records = [r for r in captured if "WIRE_RESPONSE" in r.getMessage()]
        self.assertEqual(len(wire_response_records), 1)
        rec = wire_response_records[0]
        # Raw body is COMPLETE (not truncated) and parseable back to the original.
        raw_body = rec.__dict__["wireRawBody"]
        self.assertEqual(json.loads(raw_body), deepseek_like_payload)
        # Parsed fields surfaced for quick scanning.
        self.assertEqual(rec.__dict__["wireFinishReason"], "length")
        self.assertEqual(rec.__dict__["wireMessageContent"], "")
        self.assertEqual(rec.__dict__["wireMessageReasoningContent"],
                         "We need to think hard...")
        self.assertEqual(rec.__dict__["wireUsage"]["completion_tokens"], 4096)
        # No refusal, no tool_calls in this payload.
        self.assertIsNone(rec.__dict__["wireRefusal"])
        self.assertFalse(rec.__dict__["wireHasToolCalls"])

    async def test_response_dump_handles_non_json_body(self):
        html_body = "<html><body>502 Bad Gateway</body></html>"
        captured = await self._run_with_capture(
            {}, status_code=502, body_text=html_body,
            content_type="text/html"
        )

        wire_response_records = [r for r in captured if "WIRE_RESPONSE" in r.getMessage()]
        self.assertEqual(len(wire_response_records), 1)
        rec = wire_response_records[0]
        self.assertEqual(rec.__dict__["wireRawBody"], html_body)
        self.assertIsNotNone(rec.__dict__["wireRawBodyParseError"])
        # Parsed fields stay None because the body is not JSON.
        self.assertIsNone(rec.__dict__["wireFinishReason"])
        self.assertIsNone(rec.__dict__["wireMessageContent"])


if __name__ == "__main__":
    unittest.main()