"""Anthropic adapter — wire shape of the Messages API call.

* base URL works as the API root or with a ``/v1`` suffix (no ``/v1/v1``);
* VISION sends Anthropic ``image`` blocks (images were silently dropped before);
* auth probe / model discovery use ``GET /v1/models`` (no hard-coded model id).
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from app.schemas.contract import ProviderPayload
from app.services.protocol.anthropic import AnthropicAdapter
from app.services.provider_errors import ProviderErrorCode, ProviderValidation


class _FakeClient:
    def __init__(self, response: httpx.Response) -> None:
        self.response = response
        self.calls: list[tuple[str, str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return self.response

    async def post(self, url: str, **kwargs):
        self.calls.append(("POST", url, kwargs))
        return self.response


def _provider(base_url: str = "https://api.anthropic.com", caps=None) -> ProviderPayload:
    return ProviderPayload(
        protocol="anthropic",  # type: ignore[arg-type]
        base_url=base_url,
        api_key="sk-ant-test",
        model="claude-haiku-4-5",
        capabilities=caps or {"TEXT", "VISION"},
    )


_OK = {"content": [{"type": "text", "text": "OK"}], "usage": {"input_tokens": 3, "output_tokens": 1},
       "stop_reason": "end_turn"}


class AnthropicAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_messages_url_for_root_and_v1_base(self):
        for base in ("https://api.anthropic.com", "https://api.anthropic.com/v1/", "https://proxy.test/anthropic/v1"):
            client = _FakeClient(httpx.Response(200, json=_OK))
            with patch("app.services.protocol.anthropic.httpx.AsyncClient", return_value=client):
                result = await AnthropicAdapter().chat(_provider(base), "sys", "hi")
            self.assertEqual("OK", result.text)
            url = client.calls[0][1]
            self.assertTrue(url.endswith("/v1/messages"), url)
            self.assertNotIn("/v1/v1", url)
            headers = client.calls[0][2]["headers"]
            self.assertEqual("sk-ant-test", headers["x-api-key"])
            self.assertIn("anthropic-version", headers)

    async def test_vision_sends_image_blocks(self):
        client = _FakeClient(httpx.Response(200, json=_OK))
        with patch("app.services.protocol.anthropic.httpx.AsyncClient", return_value=client):
            await AnthropicAdapter().chat(
                _provider(), "sys", "describe",
                images=["data:image/jpeg;base64,QUJD", "https://cdn.test/frame.jpg"],
            )
        content = client.calls[0][2]["json"]["messages"][0]["content"]
        self.assertEqual(
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"}},
            content[0],
        )
        self.assertEqual({"type": "image", "source": {"type": "url", "url": "https://cdn.test/frame.jpg"}},
                         content[1])
        self.assertEqual({"type": "text", "text": "describe"}, content[2])

    async def test_vision_rejects_non_image_payload(self):
        client = _FakeClient(httpx.Response(200, json=_OK))
        with patch("app.services.protocol.anthropic.httpx.AsyncClient", return_value=client):
            with self.assertRaises(ProviderValidation) as ctx:
                await AnthropicAdapter().chat(_provider(), "sys", "x", images=["file:///etc/passwd"])
        self.assertEqual(ProviderErrorCode.PROVIDER_BAD_REQUEST, ctx.exception.code)
        self.assertEqual([], client.calls)

    async def test_vision_requires_configured_capability(self):
        with self.assertRaises(Exception):
            await AnthropicAdapter().chat(_provider(caps={"TEXT"}), "sys", "x", images=["https://a.test/i.png"])

    def test_auth_probe_is_model_listing(self):
        adapter = AnthropicAdapter()
        self.assertEqual("GET", adapter.auth_probe_method().upper())
        self.assertEqual("https://api.anthropic.com/v1/models", adapter.auth_probe_url("https://api.anthropic.com"))
        self.assertEqual("https://api.anthropic.com/v1/models", adapter.auth_probe_url("https://api.anthropic.com/v1"))

    async def test_discover_models(self):
        client = _FakeClient(httpx.Response(200, json={"data": [{"id": "claude-haiku-4-5"}, {"id": "claude-sonnet-5"}]}))
        with patch("app.services.protocol.anthropic.httpx.AsyncClient", return_value=client):
            result = await AnthropicAdapter().discover_models(_provider())
        self.assertTrue(result.available)
        self.assertEqual(["claude-haiku-4-5", "claude-sonnet-5"], result.models)
