"""Anthropic native protocol adapter (TEXT only)."""
from __future__ import annotations

from typing import Any, Optional

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload, Usage
from app.services.protocol.adapter import ProtocolAdapter
from app.services.protocol.http_utils import raise_for_http_status
from app.services.protocol.types import (
    Capability,
    ChatResult,
    ModelDiscoveryResult,
    ValidationPhaseResult,
    VoiceDiscoveryStrategy,
)
from app.services.provider_errors import ProviderTransport

_prov_log = get_provider_logger("adapter.anthropic")


class AnthropicAdapter(ProtocolAdapter):
    protocol = "anthropic"
    supported_capabilities = frozenset({Capability.TEXT.value})
    voice_discovery_strategy = VoiceDiscoveryStrategy.UNSUPPORTED

    def auth_headers(self, api_key: str) -> dict[str, str]:
        return {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def auth_probe_path(self, base_url: str) -> str:
        return "/v1/messages"

    def auth_probe_method(self) -> str:
        return "POST"

    def auth_probe_body(self) -> Optional[dict[str, Any]]:
        return {
            "model": "claude-3-5-haiku-latest",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "ping"}],
        }

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
    ) -> ChatResult:
        self.require_capability(Capability.TEXT)
        base = provider.base_url.rstrip("/")
        url = base + ("/messages" if base.endswith("/v1") else "/v1/messages")
        # Anthropic Messages API does not accept OpenAI-style response_format;
        # JSON-mode is opt-in per-model. We keep the field for interface
        # parity and silently drop it for Anthropic (the system prompt
        # already instructs the model to emit JSON). Same for extra_body —
        # Anthropic does not currently accept a thinking-disable flag in
        # the wire shape we use; leave the system prompt as the lever.
        _ = response_format
        _ = extra_body
        payload = {
            "model": provider.model,
            "max_tokens": max_tokens,
            "temperature": provider.temperature,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
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
                capability="TEXT",
            ) from exc

        raise_for_http_status(resp, provider, operation="chat", capability="TEXT", log=_prov_log)
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
        return ModelDiscoveryResult(
            available=False,
            detail="Anthropic does not expose a public model listing endpoint",
        )

    async def validate_capability(
        self,
        provider: ProviderPayload,
        capability: str,
    ) -> ValidationPhaseResult:
        if capability != Capability.TEXT.value:
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
