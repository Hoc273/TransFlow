"""ProtocolAdapter — capability-oriented interface every provider implements.

Gateways call ``supports`` / ``synthesize`` / ``transcribe`` / ``chat`` through
the registry. Adapters own all vendor-specific request/response formats.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional

from app.schemas.contract import ProviderPayload
from app.services.protocol.types import (
    AudioInput,
    Capability,
    ChatResult,
    ModelDiscoveryResult,
    SynthesizeResult,
    TranscribeResult,
    TtsCacheDescriptor,
    ValidationPhaseResult,
    VoiceDiscoveryResult,
    VoiceDiscoveryStrategy,
)
from app.services.provider_errors import (
    ProviderConfiguration,
    ProviderErrorCode,
)


class ProtocolAdapter(ABC):
    """Base class for protocol adapters.

    Subclasses declare ``protocol`` and ``supported_capabilities``, then override
    only the operations they implement. Default methods raise
    ``PROVIDER_UNSUPPORTED_CAPABILITY`` so callers get a structured error.
    """

    #: Wire protocol string (must match Spring Boot ``ProviderProtocol.wire()``).
    protocol: str = ""

    #: Capabilities this adapter can execute.
    supported_capabilities: frozenset[str] = frozenset()

    #: How voices should be obtained for UI / cache.
    voice_discovery_strategy: VoiceDiscoveryStrategy = VoiceDiscoveryStrategy.UNSUPPORTED

    #: Default TTS voice for capability probes when caller omits ``voice_id`` (Q-PV-14).
    #: None → try discovery (AUTO) or skip; never invent a foreign protocol's voice.
    default_probe_voice: str | None = None

    #: True when the gateway must gate/mock this adapter on ``api_key`` presence
    #: (Phase D P2-3 runtime finding: cloud adapters extending ``ProtocolAdapter``
    #: directly had no such attribute — every gateway key-gate crashed for them).
    #: Zero-key adapters override with ``False`` (e.g. ``local_piper``).
    requires_api_key: bool = True

    # ── Capability gate ──────────────────────────────────────────────────────

    def supports(self, capability: str | Capability) -> bool:
        cap = capability.value if isinstance(capability, Capability) else capability
        return cap in self.supported_capabilities

    def require_capability(self, capability: str | Capability) -> None:
        cap = capability.value if isinstance(capability, Capability) else capability
        if not self.supports(cap):
            raise ProviderConfiguration(
                f"Protocol '{self.protocol}' does not support capability {cap}",
                code=ProviderErrorCode.PROVIDER_UNSUPPORTED_CAPABILITY,
                protocol=self.protocol,
                capability=cap,
            )

    # ── TEXT ─────────────────────────────────────────────────────────────────

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
        self._unsupported(Capability.TEXT)

    # ── STT ──────────────────────────────────────────────────────────────────

    def prefers_audio_url(self) -> bool:
        """True when the vendor accepts a remote audio URL (skip local download)."""
        return False

    async def transcribe(
        self,
        provider: ProviderPayload,
        audio: AudioInput,
        *,
        source_lang: Optional[str] = None,
    ) -> TranscribeResult:
        self._unsupported(Capability.STT)

    # ── TTS ──────────────────────────────────────────────────────────────────

    async def synthesize(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        self._unsupported(Capability.TTS)

    def cache_descriptor(
        self,
        provider: ProviderPayload,
        voice_id: str,
    ) -> TtsCacheDescriptor:
        """Static TTS cache key material + output format (A2.1).

        Default assumes an MP3-returning TTS adapter whose executed model is
        ``provider.model``; adapters with a different output format or a
        voice→model mapping (Piper, DashScope WAV) override. Adapters with a
        voice catalog must also validate the voice here (see BaseTtsAdapter)
        so a cache hit can never bypass the fail-fast voice gate. Pure, no I/O.
        """
        return TtsCacheDescriptor(
            resolved_model=provider.model,
            mime_type="audio/mpeg",
            extension="mp3",
            speed="1.0",
        )

    # ── Discovery ────────────────────────────────────────────────────────────

    async def discover_voices(
        self,
        provider: ProviderPayload,
    ) -> VoiceDiscoveryResult:
        return VoiceDiscoveryResult(
            strategy=self.voice_discovery_strategy,
            mode="UNAVAILABLE",
            voices=[],
            detail=f"Voice discovery not supported for protocol {self.protocol}",
        )

    async def discover_models(
        self,
        provider: ProviderPayload,
    ) -> ModelDiscoveryResult:
        return ModelDiscoveryResult(
            available=False,
            detail=f"Model discovery not supported for protocol {self.protocol}",
        )

    # ── Validation helpers (phases 1–4) ──────────────────────────────────────

    def auth_headers(self, api_key: str) -> dict[str, str]:
        """HTTP headers that authenticate requests for this protocol."""
        return {"Authorization": f"Bearer {api_key}"}

    def auth_probe_path(self, base_url: str) -> str:
        """Relative path used for Phase-2 authentication probe. Empty = unsupported."""
        return ""

    def auth_probe_method(self) -> str:
        return "GET"

    def auth_probe_body(self) -> Optional[dict[str, Any]]:
        return None

    def soft_pass_auth_on_404(self) -> bool:
        """Whether a 404 on the auth probe should be treated as soft-pass."""
        return False

    async def validate_capability(
        self,
        provider: ProviderPayload,
        capability: str,
    ) -> ValidationPhaseResult:
        """Phase-3 capability probe. Override per adapter for real probes."""
        if not self.supports(capability):
            return ValidationPhaseResult(
                ok=False,
                message=f"Protocol {self.protocol} does not support {capability}",
            )
        return ValidationPhaseResult(
            ok=False,
            message=f"No capability probe implemented for {capability} on {self.protocol}",
        )

    def optional_feature_hints(self) -> dict[str, bool]:
        """Static optional-feature assumptions used when live probes are skipped."""
        return {
            "streaming": False,
            "tool_calling": False,
            "realtime": False,
        }

    # ── Internal ─────────────────────────────────────────────────────────────

    def _unsupported(self, capability: Capability) -> None:
        raise ProviderConfiguration(
            f"Protocol '{self.protocol}' does not implement {capability.value}",
            code=ProviderErrorCode.PROVIDER_UNSUPPORTED_CAPABILITY,
            protocol=self.protocol,
            capability=capability.value,
        )
