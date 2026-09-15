"""Backward-compatible TTS adapter façade.

New code should use ``app.services.protocol.require_adapter`` directly.
This module re-exports the registry-backed helpers so existing imports
(``get_tts_adapter``, ``VoiceDiscovery``) keep working during the migration.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.schemas.contract import ProviderPayload, TtsVoice
from app.services.protocol import (
    SynthesizeResult,
    VoiceDiscoveryResult,
    require_adapter,
)
from app.services.provider_errors import ProviderConfiguration, ProviderErrorCode


@dataclass(frozen=True)
class VoiceDiscovery:
    """Legacy shape expected by older call sites / tests."""

    mode: str
    voices: list[TtsVoice]


class _TtsAdapterFacade:
    """Thin wrapper that exposes the old TtsProtocolAdapter surface."""

    def __init__(self, protocol: str) -> None:
        self._protocol = protocol
        self._adapter = require_adapter(protocol, capability="TTS")

    async def synthesize(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> bytes:
        result: SynthesizeResult = await self._adapter.synthesize(provider, text, voice_id)
        return result.audio_bytes

    async def list_voices(self, provider: ProviderPayload) -> VoiceDiscovery:
        discovery: VoiceDiscoveryResult = await self._adapter.discover_voices(provider)
        return VoiceDiscovery(mode=discovery.mode, voices=discovery.voices)


def get_tts_adapter(protocol: str) -> _TtsAdapterFacade:
    adapter = require_adapter(protocol)
    if not adapter.supports("TTS"):
        raise ProviderConfiguration(
            f"TTS capability is not implemented for protocol {protocol}",
            code=ProviderErrorCode.PROVIDER_UNSUPPORTED_PROTOCOL,
            protocol=protocol,
            capability="TTS",
        )
    return _TtsAdapterFacade(protocol)


# Re-export concrete classes for tests that import them by name.
from app.services.protocol.elevenlabs_native import ElevenLabsNativeAdapter  # noqa: E402
from app.services.protocol.openai_compatible import OpenAICompatibleAdapter  # noqa: E402


class OpenAICompatibleTtsAdapter:
    """Legacy class name — delegates to the protocol adapter."""

    async def synthesize(self, provider, text, voice_id) -> bytes:
        result = await OpenAICompatibleAdapter().synthesize(provider, text, voice_id)
        return result.audio_bytes

    async def list_voices(self, provider) -> VoiceDiscovery:
        discovery = await OpenAICompatibleAdapter().discover_voices(provider)
        return VoiceDiscovery(mode=discovery.mode, voices=discovery.voices)


class ElevenLabsNativeTtsAdapter:
    """Legacy class name — delegates to the protocol adapter."""

    async def synthesize(self, provider, text, voice_id) -> bytes:
        result = await ElevenLabsNativeAdapter().synthesize(provider, text, voice_id)
        return result.audio_bytes

    async def list_voices(self, provider) -> VoiceDiscovery:
        discovery = await ElevenLabsNativeAdapter().discover_voices(provider)
        return VoiceDiscovery(mode=discovery.mode, voices=discovery.voices)
