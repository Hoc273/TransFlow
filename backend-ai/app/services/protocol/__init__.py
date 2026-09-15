"""Protocol adapter framework — capability-agnostic provider dispatch.

Gateways and pipelines resolve adapters by protocol via the registry and never
branch on protocol name strings. Adding a provider requires only:

1. A protocol wire value (enum on Spring Boot + Literal here)
2. A ``ProtocolAdapter`` implementation registered in the registry
3. A preset entry (Spring Boot ``ProviderPresetService`` + optional static voices)

See ``adapter.py`` for the capability interface and ``registry.py`` for lookup.
"""
from __future__ import annotations

from app.services.protocol.adapter import ProtocolAdapter
from app.services.protocol.registry import (
    ProtocolAdapterRegistry,
    get_adapter,
    get_registry,
    require_adapter,
)
from app.services.protocol.types import (
    AudioInput,
    AudioInputType,
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

__all__ = [
    "AudioInput",
    "AudioInputType",
    "Capability",
    "ChatResult",
    "ModelDiscoveryResult",
    "ProtocolAdapter",
    "ProtocolAdapterRegistry",
    "SynthesizeResult",
    "TranscribeResult",
    "TtsCacheDescriptor",
    "ValidationPhaseResult",
    "VoiceDiscoveryResult",
    "VoiceDiscoveryStrategy",
    "get_adapter",
    "get_registry",
    "require_adapter",
]
