"""Shared types for the protocol adapter framework.

These types are the *only* shapes gateways and media pipelines should depend on.
Adapters convert vendor-specific wire formats into these generic results.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from app.schemas.contract import SttSegment, TtsVoice, Usage


class Capability(str, Enum):
    TEXT = "TEXT"
    STT = "STT"
    TTS = "TTS"
    VISION = "VISION"


class VoiceDiscoveryStrategy(str, Enum):
    """How the UI / cache layer should obtain TTS voices for a protocol.

    AUTO         — provider exposes a live voice-list endpoint
    STATIC       — voices come from preset/registry metadata (no live API)
    MANUAL       — no catalog; user enters a Voice ID manually
    UNSUPPORTED  — voice selection is not applicable
    """

    AUTO = "AUTO"
    STATIC = "STATIC"
    MANUAL = "MANUAL"
    UNSUPPORTED = "UNSUPPORTED"


class AudioInputType(str, Enum):
    URL = "URL"
    UPLOADED_FILE = "UPLOADED_FILE"
    BYTES = "BYTES"
    BASE64 = "BASE64"


@dataclass(frozen=True)
class AudioInput:
    """Generic audio payload for STT. Adapters decide how to ship it to the vendor."""

    type: AudioInputType
    url: Optional[str] = None
    path: Optional[Path] = None
    data: Optional[bytes] = None
    base64_data: Optional[str] = None
    mime_type: Optional[str] = None
    filename: Optional[str] = None

    @classmethod
    def from_url(cls, url: str, *, mime_type: str | None = None) -> "AudioInput":
        return cls(type=AudioInputType.URL, url=url, mime_type=mime_type)

    @classmethod
    def from_bytes(
        cls,
        data: bytes,
        *,
        filename: str = "audio.wav",
        mime_type: str = "audio/wav",
    ) -> "AudioInput":
        return cls(
            type=AudioInputType.BYTES,
            data=data,
            filename=filename,
            mime_type=mime_type,
        )

    @classmethod
    def from_file(
        cls,
        path: Path,
        *,
        mime_type: str = "audio/wav",
    ) -> "AudioInput":
        return cls(
            type=AudioInputType.UPLOADED_FILE,
            path=path,
            filename=path.name,
            mime_type=mime_type,
        )

    @classmethod
    def from_base64(
        cls,
        b64: str,
        *,
        filename: str = "audio.wav",
        mime_type: str = "audio/wav",
    ) -> "AudioInput":
        return cls(
            type=AudioInputType.BASE64,
            base64_data=b64,
            filename=filename,
            mime_type=mime_type,
        )

    def as_bytes(self) -> bytes:
        """Materialize audio bytes when the adapter needs a local buffer."""
        if self.data is not None:
            return self.data
        if self.base64_data is not None:
            import base64

            return base64.b64decode(self.base64_data)
        if self.path is not None:
            return self.path.read_bytes()
        raise ValueError("AudioInput has no local bytes (URL-only input)")


@dataclass
class ChatResult:
    """Generic TEXT completion result shared by all chat-capable adapters."""

    text: str
    usage: Usage
    # Wire-level finish_reason from the provider (e.g. "stop", "length",
    # "content_filter"). Adapters that cannot obtain it leave the default
    # ``"stop"``. Routes inspect this to distinguish truncation ("length")
    # from genuine empty/refusal cases so the error message reflects the
    # real cause instead of the generic "non-JSON output".
    finish_reason: str = "stop"
    # C2: provider request id from response header (e.g. x-request-id) — additive, None when absent
    request_id: Optional[str] = None


@dataclass(frozen=True)
class SynthesizeResult:
    """Generic TTS output. Adapters convert HTTP/SSE/WebSocket audio into this."""

    audio_bytes: bytes
    mime_type: str = "audio/mpeg"
    sample_rate: Optional[int] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class TtsCacheDescriptor:
    """Pre-synthesis TTS cache key material + static output facts (A2.1).

    Resolved by the adapter **before** any cache lookup so the cache key can
    be built without an engine call (ADR-CEP A2.1, B1/B2):

    * ``resolved_model`` — the model that will actually be executed
      (Piper maps voice → bundled ONNX stem; other adapters use
      ``provider.model``), so a runtime/voice-model change rotates the key.
    * ``mime_type``/``extension`` — the adapter's static output format
      (Piper/DashScope: WAV; Google/Azure/ElevenLabs/OpenAI-compatible: MP3).
    * ``speed`` — fixed ``"1.0"`` (the TTS wire contract has no speed field).

    Pure — no I/O, no vendor calls.
    """

    resolved_model: str
    mime_type: str
    extension: str
    speed: str = "1.0"


@dataclass(frozen=True)
class TranscribeResult:
    """Generic STT output shared across whisper / omni / cloud speech adapters."""

    segments: list[SttSegment]
    detected_lang: Optional[str] = None
    audio_seconds: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class VoiceDiscoveryResult:
    strategy: VoiceDiscoveryStrategy
    """Wire mode for FE cache: AUTHORITATIVE | FALLBACK | STATIC | UNAVAILABLE."""
    mode: str
    voices: list[TtsVoice] = field(default_factory=list)
    detail: Optional[str] = None


@dataclass(frozen=True)
class ModelDiscoveryResult:
    available: bool
    models: list[str] = field(default_factory=list)
    detail: Optional[str] = None


@dataclass(frozen=True)
class ValidationPhaseResult:
    """Result of a single validation phase step (connection/auth/capability/optional)."""

    ok: bool
    message: str
    duration_ms: int = 0
    detail: Optional[dict[str, Any]] = None
