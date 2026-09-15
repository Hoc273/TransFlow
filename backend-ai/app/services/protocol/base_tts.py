"""BaseTtsAdapter — shared foundation for TTS-only protocol adapters.

Phase A1.2 of ADR-CEP. Provides the TTS slice of the runtime contract:

* STATIC voice discovery backed by the catalog registry
  (``app.services.protocol.static_voices``).
* voice-exists gate — unknown ``voice_id`` raises
  ``PROVIDER_TTS_VOICE_NOT_FOUND`` *before* the vendor engine is called,
  so a stale FE voice list fails fast without burning provider calls.
* ``execution_info`` — per-call metadata ``{provider, model, voice}``
  attached to ``SynthesizeResult.metadata``; the gateway completes it with
  latency / request id / cache. Never contains the API key (TC-SEC-01).

Subclasses implement only ``_synthesize_engine``; discovery, the gate and
the metadata contract are inherited.
"""
from __future__ import annotations

from dataclasses import replace
from typing import Any

from app.schemas.contract import ProviderPayload, TtsVoice
from app.services.protocol.adapter import ProtocolAdapter
from app.services.protocol.types import (
    Capability,
    SynthesizeResult,
    TtsCacheDescriptor,
    VoiceDiscoveryResult,
    VoiceDiscoveryStrategy,
)
from app.services.provider_errors import ProviderErrorCode, ProviderValidation


class BaseTtsAdapter(ProtocolAdapter):
    """Base class for TTS-only adapters with a static voice catalog."""

    #: TTS-only adapters expose a static catalog (no live voice-list API).
    voice_discovery_strategy: VoiceDiscoveryStrategy = VoiceDiscoveryStrategy.STATIC

    #: Whether this adapter requires an API key. Zero-key System-tier adapters
    #: (e.g. local_piper) override to False so the gateway does not mock/gate
    #: on ``api_key`` presence.
    requires_api_key: bool = True

    def catalog(self) -> list[TtsVoice]:
        """Authoritative static voice catalog for this protocol."""
        from app.services.protocol.static_voices import voices_for_protocol

        return voices_for_protocol(self.protocol)

    # ── Voice gate ────────────────────────────────────────────────────────────

    def ensure_voice_known(self, voice_id: str) -> None:
        """Fail fast with ``PROVIDER_TTS_VOICE_NOT_FOUND`` for unknown voices."""
        if voice_id in {v.voice_id for v in self.catalog()}:
            return
        raise ProviderValidation(
            f"Voice '{voice_id}' is not in the static catalog for protocol '{self.protocol}'",
            code=ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND,
            protocol=self.protocol,
            capability=Capability.TTS.value,
        )

    # ── Discovery ─────────────────────────────────────────────────────────────

    async def discover_voices(
        self,
        provider: ProviderPayload,
    ) -> VoiceDiscoveryResult:
        return VoiceDiscoveryResult(
            strategy=self.voice_discovery_strategy,
            mode="STATIC",
            voices=self.catalog(),
            detail=f"Static catalog for protocol {self.protocol}",
        )

    # ── Synthesize pipeline: gate → engine → execution_info ──────────────────

    async def synthesize(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        self.require_capability(Capability.TTS)
        self.ensure_voice_known(voice_id)
        result = await self._synthesize_engine(provider, text, voice_id)
        return replace(result, metadata=self._with_execution_info(provider, voice_id, result.metadata))

    def cache_descriptor(
        self,
        provider: ProviderPayload,
        voice_id: str,
    ) -> TtsCacheDescriptor:
        """Run the pure fail-fast gates before any cache lookup (A2.1 P0-2).

        A cache hit must never bypass ``ensure_voice_known`` — a stale cached
        object for a voice removed from the catalog still raises
        ``PROVIDER_TTS_VOICE_NOT_FOUND``. Pure (static catalog only), no I/O.
        """
        self.require_capability(Capability.TTS)
        self.ensure_voice_known(voice_id)
        return super().cache_descriptor(provider, voice_id)

    async def _synthesize_engine(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        """Vendor-specific synthesis. Subclasses must implement."""
        raise NotImplementedError(f"{type(self).__name__} must implement _synthesize_engine")

    # ── execution_info contract ───────────────────────────────────────────────

    def _execution_info_meta(
        self,
        provider: ProviderPayload,
        voice_id: str,
        *,
        model: str | None = None,
    ) -> dict[str, Any]:
        """execution_info contract payload (Q-M-TTS-20 / ADR-CEP §9).

        The gateway completes it with ``latencyMs``, ``requestId`` and
        ``cache``. Deliberately excludes the API key (TC-SEC-01).
        """
        return {
            "execution_info": {
                "provider": self.protocol,
                "model": model or provider.model or None,
                "voice": voice_id,
            }
        }

    def _with_execution_info(
        self,
        provider: ProviderPayload,
        voice_id: str,
        engine_metadata: dict[str, Any],
        *,
        model: str | None = None,
    ) -> dict[str, Any]:
        """Merge the execution_info metadata with engine metadata (engine wins)."""
        meta = self._execution_info_meta(provider, voice_id, model=model)
        return {**engine_metadata, **meta}
