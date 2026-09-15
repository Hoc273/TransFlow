"""Tests for the media-pipeline summarize gateway.

Covers the JSON-extraction regression that caused the
``Invalid JSON from summarization model: Expecting value: line 1 column 1``
failure loop in production (commit 2026-07-23 audit).
"""
from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.schemas.contract import (
    ProviderPayload,
    SttSegment,
    SummarizeRequest,
    Usage,
)
from app.services import summarize_gateway
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderException,
    ProviderTransport,
)


def _request(provider: ProviderPayload | None = None) -> SummarizeRequest:
    if provider is None:
        provider = ProviderPayload(
            protocol="openai_compatible",
            base_url="https://provider.test/v1",
            api_key="sk-real-key",
            model="gpt-4o-mini",
        )
    return SummarizeRequest(
        correlation_id="corr-1",
        media_job_id="job-1",
        transcript=[
            SttSegment(text="hello world", start_ms=0, end_ms=2000),
            SttSegment(text="second line", start_ms=2000, end_ms=4000),
        ],
        requested_duration_seconds=30,
        duration_tolerance={"min_seconds": 27, "max_seconds": 33},
        provider=provider,
    )


def _usage() -> Usage:
    return Usage(input_tokens=42, output_tokens=128, provider="openai_compatible", model="gpt-4o-mini")


def _chat_result(text: str) -> object:
    from app.services.protocol import ChatResult
    return ChatResult(text=text, usage=_usage())


class MockModeTest(unittest.IsolatedAsyncioTestCase):
    async def test_mock_mode_returns_deterministic_proposals(self):
        with patch.object(summarize_gateway.settings, "mock_mode", True):
            response = await summarize_gateway.summarize(_request())
        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(len(response.proposals), 3)
        for i, p in enumerate(response.proposals, start=1):
            self.assertEqual(p.proposal_index, i)
            self.assertEqual(p.total_duration_ms, 30_000)


class ParseJsonToleranceTest(unittest.IsolatedAsyncioTestCase):
    """Regression coverage for the previous _extract_json brittleness."""

    async def _run_with_text(self, text: str):
        req = _request()
        with patch.object(summarize_gateway, "chat", AsyncMock(return_value=_chat_result(text))):
            return await summarize_gateway.summarize(req)

    async def test_clean_json_succeeds(self):
        payload = {
            "proposals": [
                {"proposal_index": 1, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "reasoning_note": "a", "total_duration_ms": 30000, "confidence": 0.8},
                {"proposal_index": 2, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "reasoning_note": "b", "total_duration_ms": 30000, "confidence": 0.7},
                {"proposal_index": 3, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "reasoning_note": "c", "total_duration_ms": 30000, "confidence": 0.6},
            ]
        }
        response = await self._run_with_text(json.dumps(payload))
        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(len(response.proposals), 3)

    async def test_prose_around_json_succeeds(self):
        payload = {
            "proposals": [
                {"proposal_index": 1, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 2, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 3, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
            ]
        }
        text = "Sure! Here is your JSON:\n" + json.dumps(payload) + "\nHope this helps."
        response = await self._run_with_text(text)
        self.assertEqual(response.status, "COMPLETED", msg=f"error={response.error}")

    async def test_markdown_fence_with_prose_succeeds(self):
        payload = {
            "proposals": [
                {"proposal_index": 1, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 2, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 3, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
            ]
        }
        text = "```json\n" + json.dumps(payload) + "\n```\nLet me know if you want changes."
        response = await self._run_with_text(text)
        self.assertEqual(response.status, "COMPLETED", msg=f"error={response.error}")

    async def test_empty_text_is_deterministic_failed(self):
        """The exact failure mode observed in production logs."""
        response = await self._run_with_text("")
        self.assertEqual(response.status, "FAILED")
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
        )
        self.assertFalse(response.error_detail.retryable)

    async def test_whitespace_only_text_is_deterministic_failed(self):
        response = await self._run_with_text("   \n  \t  ")
        self.assertEqual(response.status, "FAILED")
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
        )

    async def test_non_json_text_is_malformed_failed(self):
        response = await self._run_with_text("Here is your response. Sorry, model confused.")
        self.assertEqual(response.status, "FAILED")
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
        )
        self.assertFalse(response.error_detail.retryable)

    async def test_missing_proposals_key_is_malformed_failed(self):
        response = await self._run_with_text(json.dumps({"answer": "ok"}))
        self.assertEqual(response.status, "FAILED")
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
        )

    async def test_all_proposals_malformed_is_business_rule_violation(self):
        # Every proposal is missing the required proposal_index → dropped.
        # Empty proposals list → business rule violation, NOT retryable.
        text = json.dumps({
            "proposals": [
                {"cut_ranges": [{"start_ms": 0, "end_ms": 30000}]},
                {"cut_ranges": [{"start_ms": 0, "end_ms": 30000}]},
            ]
        })
        response = await self._run_with_text(text)
        self.assertEqual(response.status, "FAILED")
        self.assertEqual(
            response.error_detail.errorCode,
            ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION,
        )
        self.assertFalse(response.error_detail.retryable)

    async def test_partial_proposals_skip_bad_keep_good(self):
        text = json.dumps({
            "proposals": [
                {"proposal_index": 1, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": "BAD"},  # invalid type → dropped
                {"proposal_index": 3, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
            ]
        })
        response = await self._run_with_text(text)
        self.assertEqual(response.status, "COMPLETED")
        self.assertEqual(len(response.proposals), 2)
        self.assertEqual(response.proposals[0].proposal_index, 1)
        self.assertEqual(response.proposals[1].proposal_index, 3)


class ProviderExceptionTest(unittest.IsolatedAsyncioTestCase):
    async def test_provider_exception_propagates_as_failed_response(self):
        req = _request()
        exc = ProviderException(
            ProviderErrorCode.PROVIDER_RATE_LIMITED,
            "rate limited",
            provider="https://provider.test/v1",
            protocol="openai_compatible",
            capability="SUMMARIZE",
        )
        with patch.object(summarize_gateway, "chat", AsyncMock(side_effect=exc)):
            response = await summarize_gateway.summarize(req)
        self.assertEqual(response.status, "FAILED")
        self.assertEqual(response.error_detail.errorCode, ProviderErrorCode.PROVIDER_RATE_LIMITED)
        # PROVIDER_RATE_LIMITED must remain retryable so the stage can recover.
        self.assertTrue(response.error_detail.retryable)

    async def test_transport_error_propagates(self):
        req = _request()
        exc = ProviderTransport("timeout", provider="https://provider.test/v1",
                                protocol="openai_compatible")
        with patch.object(summarize_gateway, "chat", AsyncMock(side_effect=exc)):
            response = await summarize_gateway.summarize(req)
        self.assertEqual(response.status, "FAILED")
        self.assertEqual(response.error_detail.errorCode, ProviderErrorCode.PROVIDER_NETWORK_ERROR)


class ResponseFormatForwardingTest(unittest.IsolatedAsyncioTestCase):
    """Confirm summarize requests JSON mode at the wire level."""

    async def test_summarize_sends_json_object_response_format(self):
        req = _request()
        mock_chat = AsyncMock(return_value=_chat_result(json.dumps({
            "proposals": [
                {"proposal_index": 1, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 2, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 3, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
            ]
        })))
        with patch.object(summarize_gateway, "chat", mock_chat):
            await summarize_gateway.summarize(req)
        # The keyword argument must have been forwarded to the LLM gateway.
        self.assertEqual(mock_chat.await_count, 1)
        kwargs = mock_chat.await_args.kwargs
        self.assertEqual(kwargs.get("response_format"), {"type": "json_object"})


class PromptBuilderTest(unittest.TestCase):
    """Prompt must keep zero-duration segments and add explicit anti-reasoning rules."""

    def test_zero_duration_segment_is_kept_in_prompt(self):
        from app.core.prompts import build_summarize_prompt

        system, user = build_summarize_prompt(
            [{"text": "hello world", "start_ms": 0, "end_ms": 0}],
            180,
            {"min_seconds": 162, "max_seconds": 198},
        )
        self.assertIn('start_ms="0" end_ms="0"', user)
        self.assertIn("hello world", user)

    def test_system_prompt_forbids_chain_of_thought(self):
        from app.core.prompts import build_summarize_prompt

        system, _ = build_summarize_prompt(
            [{"text": "x", "start_ms": 0, "end_ms": 1000}],
            60,
            {"min_seconds": 54, "max_seconds": 66},
        )
        self.assertIn("Do NOT emit any chain-of-thought", system)
        # First character of visible reply must be '{'.
        self.assertIn("first character", system)

    def test_empty_transcript_falls_back_to_placeholder(self):
        from app.core.prompts import build_summarize_prompt

        system, user = build_summarize_prompt([], 60, {"min_seconds": 54, "max_seconds": 66})
        self.assertIn("(transcript unavailable)", user)


class HardDurationConstraintTest(unittest.TestCase):
    """Verify the SUMMARIZE prompt states the duration constraint as a HARD rule."""

    def test_system_prompt_requires_total_duration_ms_equals_sum_of_cut_ranges(self):
        from app.core.prompts import SUMMARIZE_SYSTEM

        # The hard constraint text must instruct the model to set
        # total_duration_ms equal to sum(end_ms - start_ms).
        self.assertIn("total_duration_ms MUST equal", SUMMARIZE_SYSTEM)
        self.assertIn("sum(end_ms - start_ms)", SUMMARIZE_SYSTEM)

    def test_system_prompt_states_window_not_upper_limit(self):
        from app.core.prompts import SUMMARIZE_SYSTEM

        # The model must understand the duration target is a window, not a
        # ceiling. This prevents the failure where the model proposes cuts
        # significantly shorter than the minimum tolerance.
        self.assertIn("WINDOW, not an upper limit", SUMMARIZE_SYSTEM)
        self.assertIn("significantly shorter than the minimum tolerance", SUMMARIZE_SYSTEM)
        self.assertIn("INVALID", SUMMARIZE_SYSTEM)

    def test_system_prompt_explains_units_conversion(self):
        from app.core.prompts import SUMMARIZE_SYSTEM

        # The model gets <duration_tolerance min_seconds="162" max_seconds="198"/>
        # in seconds but the JSON field is in milliseconds. The prompt must
        # explicitly call out the conversion.
        self.assertIn("SECONDS", SUMMARIZE_SYSTEM)
        self.assertIn("MILLISECONDS", SUMMARIZE_SYSTEM)
        self.assertIn("multiply by 1000", SUMMARIZE_SYSTEM)

    def test_output_format_example_uses_180000_for_180s_request(self):
        """The example should match a typical 180 s request so the model does
        not anchor on a misleading 60000 value (which it did in production).

        The OLD example had `end_ms: 60000` paired with `total_duration_ms:
        60000` for the first proposal, anchoring the model at 60 s. The new
        example must show a 180 s value as the headline for the first proposal.
        """
        from app.core.prompts import SUMMARIZE_OUTPUT_FORMAT

        # The first proposal must use a 180 s value — that is the slot the
        # model pattern-matches. Other proposals may legitimately contain
        # shorter ranges that sum to 180 s.
        # Pull out the first proposal's total_duration_ms.
        import json
        import re
        m = re.search(r"<output_format>(.+?)</output_format>", SUMMARIZE_OUTPUT_FORMAT)
        self.assertIsNotNone(m)
        example = json.loads(m.group(1))
        self.assertEqual(example["proposals"][0]["total_duration_ms"], 180000)
        # First proposal must NOT anchor at 60000 (the misleading example value).
        self.assertNotEqual(example["proposals"][0]["total_duration_ms"], 60000)

        # All three proposals must show 180000 to set the anchor correctly.
        for p in example["proposals"]:
            self.assertEqual(p["total_duration_ms"], 180000,
                             f"Proposal {p['proposal_index']} anchor value must be 180000")

    def test_output_format_example_proposals_are_self_consistent(self):
        """Every example proposal's total_duration_ms must equal sum(end_ms - start_ms)."""
        import json
        import re
        from app.core.prompts import SUMMARIZE_OUTPUT_FORMAT

        # Extract the JSON inside <output_format>...</output_format>
        m = re.search(r"<output_format>(.+?)</output_format>", SUMMARIZE_OUTPUT_FORMAT)
        self.assertIsNotNone(m, "SUMMARIZE_OUTPUT_FORMAT must wrap JSON in <output_format> tags")
        example = json.loads(m.group(1))

        for proposal in example["proposals"]:
            reported = proposal["total_duration_ms"]
            computed = sum(r["end_ms"] - r["start_ms"] for r in proposal["cut_ranges"])
            self.assertEqual(
                reported, computed,
                f"Example proposal {proposal['proposal_index']} is internally "
                f"inconsistent: total_duration_ms={reported}, "
                f"sum(cut_ranges)={computed}. The model will pattern-match this.",
            )


class ConfigTest(unittest.TestCase):
    def test_summarize_max_tokens_is_at_least_2048(self):
        from app.core.config import settings

        self.assertGreaterEqual(settings.summarize_max_tokens, 2048)

    def test_text_request_timeout_at_least_60s(self):
        from app.core.config import settings

        self.assertGreaterEqual(settings.text_request_timeout_seconds, 60.0)


class ThinkingDisableTest(unittest.IsolatedAsyncioTestCase):
    """DeepSeek V4 reasoning suppression — see memory deepseek-v4-reasoning-control."""

    async def test_summarize_forwards_thinking_disabled(self):
        """When disable_thinking_for_summarize is on (default), summarize passes
        extra_body={'thinking': {'type': 'disabled'}} to the LLM gateway."""
        req = _request()
        mock_chat = AsyncMock(return_value=_chat_result(json.dumps({
            "proposals": [
                {"proposal_index": 1, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 2, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 3, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
            ]
        })))
        with patch.object(summarize_gateway, "chat", mock_chat):
            await summarize_gateway.summarize(req)
        kwargs = mock_chat.await_args.kwargs
        self.assertEqual(kwargs.get("extra_body"), {"thinking": {"type": "disabled"}})

    async def test_summarize_omits_extra_body_when_flag_disabled(self):
        from app.core.config import settings

        req = _request()
        mock_chat = AsyncMock(return_value=_chat_result(json.dumps({
            "proposals": [
                {"proposal_index": 1, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 2, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
                {"proposal_index": 3, "cut_ranges": [{"start_ms": 0, "end_ms": 30000}],
                 "total_duration_ms": 30000},
            ]
        })))
        original = settings.disable_thinking_for_summarize
        try:
            with patch.object(settings, "disable_thinking_for_summarize", False):
                with patch.object(summarize_gateway, "chat", mock_chat):
                    await summarize_gateway.summarize(req)
            self.assertIsNone(mock_chat.await_args.kwargs.get("extra_body"))
        finally:
            with patch.object(settings, "disable_thinking_for_summarize", original):
                pass


class OpenAIAdapterExtraBodyTest(unittest.IsolatedAsyncioTestCase):
    """Verify extra_body lands in the chat-completions payload."""

    async def test_extra_body_is_merged_into_payload(self):
        captured: dict = {}

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                captured.update(kwargs)
                return httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": "OK"}}],
                          "usage": {"prompt_tokens": 1, "completion_tokens": 1}},
                )

        from app.services.protocol.openai_compatible import OpenAICompatibleAdapter

        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient",
                   return_value=_Client()):
            await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible", "deepseek-v4-flash-free"),
                system="sys",
                user="hi",
                extra_body={"thinking": {"type": "disabled"}},
            )

        body = captured["json"]
        self.assertEqual(body.get("thinking"), {"type": "disabled"})
        # Gateway-controlled fields win over extra_body.
        self.assertEqual(body["model"], "deepseek-v4-flash-free")

    async def test_extra_body_keys_do_not_override_gateway_keys(self):
        """If extra_body collides with a gateway field (e.g. model), the
        gateway contract takes precedence — extra_body is opt-in extras."""
        captured: dict = {}

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                captured.update(kwargs)
                return httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": "OK"}}],
                          "usage": {"prompt_tokens": 1, "completion_tokens": 1}},
                )

        from app.services.protocol.openai_compatible import OpenAICompatibleAdapter

        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient",
                   return_value=_Client()):
            await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible", "real-model"),
                system="sys",
                user="hi",
                extra_body={"model": "hijacked-model"},
            )

        self.assertEqual(captured["json"]["model"], "real-model")


def _provider(protocol: str, model: str = "test-model", **kwargs):
    from app.schemas.contract import ProviderPayload

    return ProviderPayload(
        protocol=protocol,  # type: ignore[arg-type]
        base_url=kwargs.get("base_url", "https://provider.test/v1"),
        api_key=kwargs.get("api_key", "sk-test"),
        model=model,
        capabilities=kwargs.get("capabilities"),
    )


if __name__ == "__main__":
    unittest.main()
