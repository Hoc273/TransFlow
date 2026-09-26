"""Anthropic native protocol adapter (TEXT + VISION).

Messages API: ``POST {root}/v1/messages`` with ``x-api-key`` +
``anthropic-version``. The base URL may be the API root
(``https://api.anthropic.com``) or end in ``/v1``; both resolve to the same
paths. The auth probe is ``GET /v1/models`` — free, and independent of any model
id (a probe that names a retired model reports a valid key as broken).
"""
from __future__ import annotations

from typing import Any, Optional

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload, Usage
from app.services.protocol.adapter import ProtocolAdapter
from app.services.protocol.http_utils import normalize_base_url, raise_for_http_status
from app.services.protocol.types import (
    Capability,
    ChatResult,
    ModelDiscoveryResult,
    ValidationPhaseResult,
    VoiceDiscoveryStrategy,
)
from app.services.provider_errors import ProviderErrorCode, ProviderTransport, ProviderValidation

_prov_log = get_provider_logger("adapter.anthropic")

_DATA_URI_PREFIX = "data:"


def _api_path(base_url: str, path: str) -> str:
    """``/v1/<path>`` for an API root, ``/<path>`` when the base already ends in ``/v1``."""
    return f"/{path}" if normalize_base_url(base_url).endswith("/v1") else f"/v1/{path}"


def _image_block(image: str, provider: ProviderPayload) -> dict[str, Any]:
    """Anthropic image content block from an http(s) URL or a ``data:image/...;base64`` URI."""
    if isinstance(image, str) and image.startswith(("http://", "https://")):
        return {"type": "image", "source": {"type": "url", "url": image}}
    if isinstance(image, str) and image.startswith(_DATA_URI_PREFIX + "image/") and ";base64," in image:
        header, data = image[len(_DATA_URI_PREFIX):].split(";base64,", 1)
        return {"type": "image", "source": {"type": "base64", "media_type": header, "data": data}}
    raise ProviderValidation(
        "Vision image must be an http(s) URL or a data:image/...;base64 URI",
        code=ProviderErrorCode.PROVIDER_BAD_REQUEST,
        provider=provider.base_url,
        protocol=provider.protocol,
        capability="VISION",
    )


class AnthropicAdapter(ProtocolAdapter):
    protocol = "anthropic"
    supported_capabilities = frozenset({Capability.TEXT.value, Capability.VISION.value})
    voice_discovery_strategy = VoiceDiscoveryStrategy.UNSUPPORTED

    def auth_headers(self, api_key: str) -> dict[str, str]:
        return {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def auth_probe_path(self, base_url: str) -> str:
        return _api_path(base_url, "models")

    def optional_feature_hints(self) -> dict[str, bool]:
        return {"streaming": True, "tool_calling": False, "realtime": False}

    async def chat(
        self,
        provider: ProviderPayload,
        system: str,
        user: str,
        *,
        max_tokens: int = 2048,
        response_format: Optional[dict[str, Any]] = None,
        extra_body: Optional[dict[str, Any]] = None,
        images: Optional[list[str]] = None,
    ) -> ChatResult:
        capability = Capability.VISION.value if images else Capability.TEXT.value
        self.require_provider_capability(provider, capability)
        url = normalize_base_url(provider.base_url) + _api_path(provider.base_url, "messages")
        # Anthropic Messages API does not accept OpenAI-style response_format;
        # JSON-mode is opt-in per-model. We keep the field for interface
        # parity and silently drop it for Anthropic (the system prompt
        # already instructs the model to emit JSON). Same for extra_body —
        # Anthropic does not currently accept a thinking-disable flag in
        # the wire shape we use; leave the system prompt as the lever.
        _ = response_format
        _ = extra_body
        content: Any = user
        if images:
            content = [*(_image_block(img, provider) for img in images), {"type": "text", "text": user}]
        payload: dict[str, Any] = {
            "model": provider.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": content}],
        }
        if provider.temperature is not None:
            payload["temperature"] = provider.temperature
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                resp = await client.post(
                    url,
                    headers=self.auth_headers(provider.api_key),
                    json=payload,
                )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability=capability,
            ) from exc

        raise_for_http_status(resp, provider, operation="chat", capability=capability, log=_prov_log)
        data = resp.json()
        text = "".join(
            block.get("text", "")
            for block in data.get("content", [])
            if block.get("type") == "text"
        ).strip()
        u = data.get("usage") or {}
        # Anthropic Maps stop_reason: "end_turn" | "max_tokens" | "stop_sequence"
        # | "tool_use". Translate to OpenAI-style finish_reason for parity.
        raw_stop = data.get("stop_reason")
        finish_reason = "length" if raw_stop == "max_tokens" else "stop"
        return ChatResult(
            text=text,
            usage=Usage(
                input_tokens=u.get("input_tokens", 0),
                output_tokens=u.get("output_tokens", 0),
                provider=self.protocol,
                model=provider.model,
            ),
            finish_reason=finish_reason,
        )

    async def discover_models(self, provider: ProviderPayload) -> ModelDiscoveryResult:
        url = normalize_base_url(provider.base_url) + _api_path(provider.base_url, "models")
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                resp = await client.get(url, headers=self.auth_headers(provider.api_key))
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            return ModelDiscoveryResult(available=False, detail=f"Model listing unreachable: {exc}")
        if resp.status_code >= 400:
            return ModelDiscoveryResult(available=False, detail=f"Model listing returned {resp.status_code}")
        models = [m.get("id") for m in (resp.json() or {}).get("data", []) if m.get("id")]
        return ModelDiscoveryResult(available=True, models=models, detail=f"{len(models)} models")

    async def validate_capability(
        self,
        provider: ProviderPayload,
        capability: str,
    ) -> ValidationPhaseResult:
        if capability not in (Capability.TEXT.value, Capability.VISION.value):
            return ValidationPhaseResult(
                ok=False,
                message=f"Protocol {self.protocol} does not support {capability}",
            )
        try:
            result = await self.chat(
                provider,
                system="You are a connectivity probe.",
                user="Reply with the single word: OK",
                max_tokens=8,
            )
            return ValidationPhaseResult(
                ok=True,
                message="Chat completion probe successful"
                + (f": {result.text[:40]}" if result.text else ""),
            )
        except Exception as exc:
            return ValidationPhaseResult(ok=False, message=str(exc))
