"""LLM Gateway — provider-agnostic chat completion for the AI microservice (0.6).

Roles (see docs/01-architecture.md §3):
  * Provider-agnostic: resolves a ``ProtocolAdapter`` via the registry and calls
    ``adapter.chat(...)``. No protocol-name branching lives here.
  * Structured output: callers pass a system+user prompt that demands a JSON object;
    this module returns the raw assistant text and token usage. JSON parsing/validation
    lives in the endpoint layer so the model can be retried on malformed output.
  * Resilient (Rule 3): exponential-backoff retry on 429/5xx/transport errors.
  * Mock mode: when settings.mock_mode is on, or the request key is a placeholder,
    returns deterministic text so the service runs without real API calls.

This module never logs api keys or full source text.
"""
from __future__ import annotations

import asyncio
from typing import Any, Optional

from app.core.config import settings
from app.core.logging_config import get_internal_logger, get_provider_logger
from app.schemas.contract import ProviderPayload, Usage
from app.services.protocol import ChatResult, require_adapter
from app.services.provider_errors import (
    ProviderException,
    ProviderTransport,
)

# Re-export for callers that import ChatResult from this module.
__all__ = ["ChatResult", "chat"]

_int_log = get_internal_logger("llm_gateway")
_prov_log = get_provider_logger("llm_gateway")


async def chat(
    provider: ProviderPayload,
    system: str,
    user: str,
    *,
    max_tokens: int = 2048,
    response_format: Optional[dict[str, Any]] = None,
    extra_body: Optional[dict[str, Any]] = None,
) -> ChatResult:
    """Single-turn chat completion. Returns assistant text + token usage.

    Args:
        response_format: optional wire-level structured-output hint
            (e.g. ``{"type": "json_object"}`` for OpenAI-compatible
            adapters). Anthropic ignores it; OpenAI-compatible and
            DashScope compatible-mode forward it as-is.
        extra_body: optional extra JSON fields merged into the chat
            request body (e.g. ``{"thinking": {"type": "disabled"}}``
            for DeepSeek V4 to suppress chain-of-thought). Adapters
            that do not understand a given field are expected to
            forward it as-is; OpenAI-compatible endpoints typically
            ignore unknown keys.
    """
    if settings.mock_mode or not settings.key_is_usable(provider.api_key):
        return _mock_chat(provider, user)

    adapter = require_adapter(provider.protocol, capability="TEXT")
    return await _retry(
        lambda: adapter.chat(
            provider,
            system,
            user,
            max_tokens=max_tokens,
            response_format=response_format,
            extra_body=extra_body,
        ),
        provider,
    )


async def _retry(call, provider: ProviderPayload) -> ChatResult:
    """Run ``call()`` with exponential backoff on retryable failures."""
    import httpx

    attempt = 0
    while True:
        try:
            return await call()
        except ProviderException as exc:
            if exc.retryable and attempt < settings.max_retries:
                await _sleep_backoff(attempt)
                attempt += 1
                continue
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            if attempt < settings.max_retries:
                await _sleep_backoff(attempt)
                attempt += 1
                continue
            raise ProviderTransport(
                f"Transport error reaching provider: {type(exc).__name__}",
                provider=provider.base_url,
                protocol=provider.protocol,
            ) from exc


async def _sleep_backoff(attempt: int) -> None:
    delay = (settings.backoff_base_ms / 1000.0) * (2 ** attempt)
    await asyncio.sleep(delay)


def _mock_chat(provider: ProviderPayload, user: str) -> ChatResult:
    """Deterministic stand-in used when mock_mode is on or the key is a placeholder."""
    if "<translated_text>" in user:
        text = '{"issues": [], "score": 1.0}'
    else:
        source = _between(user, "<source_text>", "</source_text>") or "(mock)"
        text = f'{{"translation": "[MOCK {provider.model}] {source}", "applied_glossary": []}}'
    usage = Usage(input_tokens=0, output_tokens=0, provider=provider.protocol, model=provider.model)
    return ChatResult(text=text, usage=usage)


def _between(text: str, start: str, end: str) -> str | None:
    i = text.find(start)
    if i == -1:
        return None
    i += len(start)
    j = text.find(end, i)
    return text[i:j] if j != -1 else None
