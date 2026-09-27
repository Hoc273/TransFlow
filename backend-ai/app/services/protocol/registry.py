"""Protocol adapter registry — single lookup for all provider protocols.

Usage::

    adapter = require_adapter(provider.protocol)
    if not adapter.supports("TTS"):
        ...
    result = await adapter.synthesize(provider, text, voice_id)

No gateway or media pipeline should contain ``if protocol == ...`` branches.
"""
from __future__ import annotations

from typing import Iterable

from app.services.protocol.adapter import ProtocolAdapter
from app.services.protocol.anthropic import AnthropicAdapter
from app.services.protocol.azure_tts import AzureSpeechAdapter
from app.services.protocol.dashscope_native import DashScopeNativeAdapter
from app.services.protocol.elevenlabs_native import ElevenLabsNativeAdapter
from app.services.protocol.google_tts import GoogleSpeechAdapter
from app.services.protocol.openai_compatible import OpenAICompatibleAdapter
from app.services.provider_errors import ProviderConfiguration, ProviderErrorCode


class ProtocolAdapterRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, ProtocolAdapter] = {}

    def register(self, adapter: ProtocolAdapter) -> None:
        if not adapter.protocol:
            raise ValueError("Adapter must declare a non-empty protocol wire value")
        self._adapters[adapter.protocol] = adapter

    def get(self, protocol: str) -> ProtocolAdapter | None:
        if not protocol:
            return None
        return self._adapters.get(protocol.strip().lower())

    def require(self, protocol: str, *, capability: str | None = None) -> ProtocolAdapter:
        adapter = self.get(protocol)
        if adapter is None:
            raise ProviderConfiguration(
                f"No protocol adapter registered for '{protocol}'",
                code=ProviderErrorCode.PROVIDER_UNSUPPORTED_PROTOCOL,
                protocol=protocol,
                capability=capability,
            )
        if capability is not None:
            adapter.require_capability(capability)
        return adapter

    def protocols(self) -> list[str]:
        return sorted(self._adapters.keys())

    def adapters(self) -> Iterable[ProtocolAdapter]:
        return self._adapters.values()

    def supports(self, protocol: str, capability: str) -> bool:
        adapter = self.get(protocol)
        return bool(adapter and adapter.supports(capability))


def _build_default_registry() -> ProtocolAdapterRegistry:
    registry = ProtocolAdapterRegistry()
    for adapter in (
        OpenAICompatibleAdapter(),
        AnthropicAdapter(),
        ElevenLabsNativeAdapter(),
        DashScopeNativeAdapter(),
        GoogleSpeechAdapter(),
        AzureSpeechAdapter(),
    ):
        registry.register(adapter)
    return registry


_REGISTRY: ProtocolAdapterRegistry | None = None


def get_registry() -> ProtocolAdapterRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = _build_default_registry()
    return _REGISTRY


def get_adapter(protocol: str) -> ProtocolAdapter | None:
    return get_registry().get(protocol)


def require_adapter(protocol: str, *, capability: str | None = None) -> ProtocolAdapter:
    return get_registry().require(protocol, capability=capability)
