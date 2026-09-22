"""4-phase provider validation gateway (docs/07 §L, Q-PV-*).

Each phase is independent: failure in one does not block the others from
attempting, though the overall result is FAIL if any mandatory phase fails.

Protocol-specific behaviour is delegated to ``ProtocolAdapter`` — this module
never branches on protocol name strings.
"""
from __future__ import annotations

import base64
import io
import struct
import time

import httpx

from app.core.config import settings
from app.core.logging_config import get_internal_logger, get_provider_logger
from app.schemas.contract import ProviderPayload
from app.schemas.validate import (
    AuthProbeRequest,
    AuthProbeResponse,
    ConnectionProbeRequest,
    ConnectionProbeResponse,
    FeaturesProbeRequest,
    FeaturesProbeResponse,
    OptionalFeatureResult,
    PhaseResult,
    SttProbeRequest,
    SttProbeResponse,
    TtsProbeRequest,
    TtsProbeResponse,
    VisionProbeRequest,
    VisionProbeResponse,
)
from app.services.protocol import AudioInput, get_adapter, require_adapter
from app.services.protocol.http_utils import normalize_base_url
from app.services.provider_errors import ProviderErrorCode, ProviderException

_int_log = get_internal_logger("validate_gateway")
_prov_log = get_provider_logger("validate_gateway")


# ── Tiny WAV generator (500ms, 8000Hz, mono, 16-bit PCM, 440Hz tone) ─────────

def _generate_tiny_wav() -> bytes:
    """Create a minimal valid WAV file (~500ms 440Hz tone) for STT probe.

    A pure-silence probe yields no speech segments on some STT providers
    (e.g. DashScope Qwen-Omni returns an empty transcript), so the probe
    emits a short audible tone instead. 500ms is the shortest duration
    verified to return at least one segment on DashScope qwen3.5-omni-plus.
    """
    import math

    sample_rate = 8000
    num_channels = 1
    bits_per_sample = 16
    num_samples = 4000  # 500ms at 8000Hz
    data_size = num_samples * num_channels * (bits_per_sample // 8)

    amplitude = 6000
    frequency = 440.0
    pcm_data = b"".join(
        struct.pack(
            "<h",
            int(amplitude * math.sin(2 * math.pi * frequency * i / sample_rate)),
        )
        for i in range(num_samples)
    )

    audio_format = 1  # PCM
    byte_rate = sample_rate * num_channels * (bits_per_sample // 8)
    block_align = num_channels * (bits_per_sample // 8)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        audio_format,
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    return header + pcm_data


_TINY_WAV: bytes | None = None


def tiny_wav_bytes() -> bytes:
    """Lazy-cached minimal WAV for STT probes."""
    global _TINY_WAV
    if _TINY_WAV is None:
        _TINY_WAV = _generate_tiny_wav()
    return _TINY_WAV


_TINY_VISION_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


# ── Phase 1: CONNECTION ──────────────────────────────────────────────────────

async def probe_connection(req: ConnectionProbeRequest) -> ConnectionProbeResponse:
    """Phase 1 — server reachability without API key."""
    url = normalize_base_url(req.base_url)
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.head(url)
                if response.status_code == 405:
                    response = await client.get(url)
            except httpx.TimeoutException:
                elapsed = int((time.monotonic() - start) * 1000)
                return ConnectionProbeResponse(
                    ok=False, duration_ms=elapsed,
                    message="Connection timed out (10s)",
                )
            except httpx.TransportError as exc:
                elapsed = int((time.monotonic() - start) * 1000)
                return ConnectionProbeResponse(
                    ok=False, duration_ms=elapsed,
                    message=f"Cannot reach server: {exc}",
                )

        elapsed = int((time.monotonic() - start) * 1000)
        if response.status_code < 500 or response.status_code in (502, 503):
            return ConnectionProbeResponse(
                ok=True, duration_ms=elapsed,
                message=f"Server reachable (status {response.status_code})",
            )
        return ConnectionProbeResponse(
            ok=True, duration_ms=elapsed,
            message=f"Server reachable but returning {response.status_code}",
        )
    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        return ConnectionProbeResponse(
            ok=False, duration_ms=elapsed,
            message=f"Unexpected error: {exc}",
        )


# ── Phase 2: AUTHENTICATION ──────────────────────────────────────────────────

async def probe_auth(req: AuthProbeRequest) -> AuthProbeResponse:
    """Phase 2 — API key validity via the protocol adapter's auth probe."""
    if settings.mock_mode or not settings.key_is_usable(req.api_key):
        return AuthProbeResponse(ok=True, duration_ms=0, message="Auth probe skipped (mock mode)")

    adapter = get_adapter(req.protocol)
    if adapter is None:
        return AuthProbeResponse(
            ok=False, duration_ms=0,
            message=f"No adapter registered for protocol '{req.protocol}'",
        )

    path = adapter.auth_probe_path(req.base_url)
    if not path:
        return AuthProbeResponse(
            ok=False, duration_ms=0,
            message=f"No auth probe defined for protocol '{req.protocol}'",
        )

    headers = adapter.auth_headers(req.api_key)
    url = normalize_base_url(req.base_url) + path
    method = adapter.auth_probe_method()
    body = adapter.auth_probe_body()

    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if method.upper() == "POST":
                response = await client.post(url, headers=headers, json=body)
            else:
                response = await client.get(url, headers=headers)
    except httpx.TimeoutException:
        elapsed = int((time.monotonic() - start) * 1000)
        return AuthProbeResponse(ok=False, duration_ms=elapsed, message="Auth timed out (15s)")
    except httpx.TransportError as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        return AuthProbeResponse(ok=False, duration_ms=elapsed, message=f"Cannot reach auth endpoint: {exc}")

    elapsed = int((time.monotonic() - start) * 1000)

    if response.status_code == 401:
        return AuthProbeResponse(ok=False, duration_ms=elapsed, message="Invalid API key (401)")
    if response.status_code == 403:
        return AuthProbeResponse(ok=False, duration_ms=elapsed, message="API key forbidden (403)")
    if response.status_code >= 400:
        if adapter.soft_pass_auth_on_404() and response.status_code == 404:
            return AuthProbeResponse(
                ok=True, duration_ms=elapsed,
                message="Auth accepted (endpoint 404 — key likely valid, no model catalog)",
            )
        return AuthProbeResponse(
            ok=False, duration_ms=elapsed,
            message=f"Auth endpoint returned {response.status_code}",
        )

    return AuthProbeResponse(ok=True, duration_ms=elapsed, message="API key valid")


# ── Phase 3: CAPABILITY ──────────────────────────────────────────────────────

async def probe_text_capability(provider: ProviderPayload) -> PhaseResult:
    """Phase 3 TEXT — chat completion probe via adapter."""
    start = time.monotonic()
    try:
        adapter = require_adapter(provider.protocol, capability="TEXT")
        result = await adapter.chat(
            provider,
            system="You are a connectivity probe.",
            user="Reply with the single word: OK",
            max_tokens=8,
        )
        elapsed = int((time.monotonic() - start) * 1000)
        return PhaseResult(
            status="PASS", duration_ms=elapsed,
            message="Chat completion probe successful"
            + (f": {result.text[:40]}" if result.text else ""),
        )
    except ProviderException as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        return PhaseResult(status="FAIL", duration_ms=elapsed, message=exc.message or str(exc))
    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        return PhaseResult(status="FAIL", duration_ms=elapsed, message=str(exc))


async def probe_stt_capability(req: SttProbeRequest) -> SttProbeResponse:
    """Phase 3 STT — tiny transcription probe via adapter + AudioInput."""
    provider = req.provider

    if settings.mock_mode or not settings.key_is_usable(provider.api_key):
        return SttProbeResponse(ok=True, duration_ms=0, message="STT probe skipped (mock mode)")

    try:
        adapter = require_adapter(provider.protocol, capability="STT")
    except ProviderException as exc:
        return SttProbeResponse(ok=False, duration_ms=0, message=exc.message or str(exc))

    if req.audio_base64:
        audio = AudioInput.from_base64(req.audio_base64, filename="probe.wav", mime_type="audio/wav")
    else:
        audio = AudioInput.from_bytes(tiny_wav_bytes(), filename="probe.wav", mime_type="audio/wav")

    start = time.monotonic()
    for attempt in range(2):
        try:
            result = await adapter.transcribe(provider, audio)
            elapsed = int((time.monotonic() - start) * 1000)
            detected = None
            if result.segments:
                detected = result.segments[0].text[:80] if result.segments[0].text else None
            return SttProbeResponse(
                ok=True, duration_ms=elapsed,
                message="STT transcription probe successful",
                detected_text=detected,
            )
        except ProviderException as exc:
            # The probe audio is a synthetic 440Hz tone, not speech — the
            # LLM-based ASR (e.g. DashScope Qwen-Omni) legitimately reports
            # "no speech" on a subset of runs. Retry once on empty/no-speech
            # before declaring the provider unhealthy; anything else fails fast.
            if exc.code == ProviderErrorCode.PROVIDER_EMPTY_RESPONSE and attempt == 0:
                continue
            elapsed = int((time.monotonic() - start) * 1000)
            return SttProbeResponse(ok=False, duration_ms=elapsed, message=exc.message or str(exc))
        except Exception as exc:
            elapsed = int((time.monotonic() - start) * 1000)
            return SttProbeResponse(ok=False, duration_ms=elapsed, message=str(exc))


async def probe_vision_capability(req: VisionProbeRequest) -> VisionProbeResponse:
    """Phase 3 VISION - prove the configured model accepts image input."""
    provider = req.provider

    if settings.mock_mode or not settings.key_is_usable(provider.api_key):
        return VisionProbeResponse(ok=True, duration_ms=0, message="VISION probe skipped (mock mode)")

    start = time.monotonic()
    try:
        adapter = require_adapter(provider.protocol, capability="VISION")
        image_data_url = req.image_data_url or _TINY_VISION_DATA_URL
        result = await adapter.chat(
            provider,
            system="You are a connectivity probe.",
            user="Look at the image and reply with one short word.",
            max_tokens=8,
            images=[image_data_url],
        )
        elapsed = int((time.monotonic() - start) * 1000)
        answer = (result.text or "").strip()
        if not answer:
            return VisionProbeResponse(
                ok=False,
                duration_ms=elapsed,
                message="VISION provider returned an empty answer",
            )
        return VisionProbeResponse(
            ok=True,
            duration_ms=elapsed,
            message="VISION image-input probe successful",
            detected_text=answer[:80],
        )
    except ProviderException as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        return VisionProbeResponse(ok=False, duration_ms=elapsed, message=exc.message or str(exc))
    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        return VisionProbeResponse(ok=False, duration_ms=elapsed, message=str(exc))


async def probe_tts_capability(req: TtsProbeRequest) -> TtsProbeResponse:
    """Phase 3 TTS — tiny synthesis probe via adapter.

    Voice resolution (Q-PV-14) when ``voice_id`` is omitted:
    adapter.default_probe_voice → STATIC catalog first voice → AUTO discovery first voice.
    If still unresolved, return ok=True with a skip message (Spring maps SKIPPED).
    """
    provider = req.provider

    # Phase D P2: resolve the adapter BEFORE the key gate. Zero-key adapters
    # (requires_api_key=False, e.g. local_piper) must never be probe-skipped on
    # an empty/placeholder key — this mirrors tts_gateway.py's zero-key gate.
    try:
        adapter = require_adapter(provider.protocol, capability="TTS")
    except ProviderException as exc:
        return TtsProbeResponse(ok=False, duration_ms=0, message=exc.message or str(exc), audio_bytes=0)

    if settings.mock_mode or (adapter.requires_api_key and not settings.key_is_usable(provider.api_key)):
        return TtsProbeResponse(ok=True, duration_ms=0, message="TTS probe skipped (mock mode)", audio_bytes=1024)

    start = time.monotonic()
    try:
        voice_id = (req.voice_id or "").strip() or None
        if not voice_id:
            voice_id = await _resolve_probe_voice(provider, adapter)
        if not voice_id:
            elapsed = int((time.monotonic() - start) * 1000)
            return TtsProbeResponse(
                ok=True,
                duration_ms=elapsed,
                message=(
                    "TTS probe skipped — no user voice, no preset default, "
                    "and voice discovery not required"
                ),
                audio_bytes=0,
            )
        synth = await adapter.synthesize(provider, req.text, voice_id)
        elapsed = int((time.monotonic() - start) * 1000)
        if not synth.audio_bytes:
            return TtsProbeResponse(ok=False, duration_ms=elapsed, message="TTS returned empty audio", audio_bytes=0)
        return TtsProbeResponse(
            ok=True, duration_ms=elapsed,
            message=f"TTS synthesis probe successful (voice={voice_id})",
            audio_bytes=len(synth.audio_bytes),
        )
    except ProviderException as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        return TtsProbeResponse(ok=False, duration_ms=elapsed, message=exc.message or str(exc), audio_bytes=0)
    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        return TtsProbeResponse(ok=False, duration_ms=elapsed, message=str(exc), audio_bytes=0)


async def _resolve_probe_voice(provider: ProviderPayload, adapter) -> str | None:
    """Fallback voice resolution for direct /tts-probe callers (Q-PV-14)."""
    if getattr(adapter, "default_probe_voice", None):
        return str(adapter.default_probe_voice).strip() or None

    from app.services.protocol.static_voices import default_probe_voice_for_protocol

    preset = default_probe_voice_for_protocol(provider.protocol)
    if preset:
        return preset

    strategy = getattr(adapter.voice_discovery_strategy, "value", str(adapter.voice_discovery_strategy))
    if strategy == "STATIC":
        try:
            discovery = await adapter.discover_voices(provider)
            if discovery.voices:
                return discovery.voices[0].voice_id
        except Exception:
            return None
        return None

    if strategy == "AUTO":
        try:
            discovery = await adapter.discover_voices(provider)
            if discovery.voices:
                return discovery.voices[0].voice_id
        except Exception:
            return None
    return None


# ── Phase 4: OPTIONAL FEATURES ──────────────────────────────────────────────

async def probe_optional_features(req: FeaturesProbeRequest) -> FeaturesProbeResponse:
    """Phase 4 — probe optional features (non-blocking).

    Failures here are recorded as ``available=False`` with detail explaining
    why, but NEVER cause the overall validation to FAIL.
    """
    provider = req.provider
    adapter = get_adapter(provider.protocol)

    voice_result = await _probe_voice_discovery(provider, adapter)
    model_result = await _probe_model_discovery(provider, adapter)

    hints = adapter.optional_feature_hints() if adapter else {}
    streaming_result = OptionalFeatureResult(
        available=bool(hints.get("streaming")),
        detail=(
            f"Protocol {provider.protocol} typically supports streaming"
            if hints.get("streaming")
            else "Streaming not indicated for this protocol"
        ),
    )
    tool_result = OptionalFeatureResult(
        available=bool(hints.get("tool_calling")),
        detail="Not probed in MVP" if not hints.get("tool_calling") else "Tool calling indicated",
    )
    realtime_result = OptionalFeatureResult(
        available=bool(hints.get("realtime")),
        detail="Not available in MVP" if not hints.get("realtime") else "Realtime indicated",
    )

    return FeaturesProbeResponse(
        voice_discovery=voice_result,
        model_discovery=model_result,
        streaming=streaming_result,
        tool_calling=tool_result,
        realtime=realtime_result,
    )


async def _probe_voice_discovery(provider: ProviderPayload, adapter) -> OptionalFeatureResult:
    """Optional — strategy UNSUPPORTED/MANUAL does not invalidate the provider."""
    if adapter is None or not adapter.supports("TTS"):
        return OptionalFeatureResult(
            available=False,
            detail=f"Voice discovery not applicable for protocol {provider.protocol}",
        )

    strategy = adapter.voice_discovery_strategy.value
    if strategy == "UNSUPPORTED":
        return OptionalFeatureResult(
            available=False,
            detail=f"Voice discovery unsupported for protocol {provider.protocol}",
        )
    if strategy == "MANUAL":
        return OptionalFeatureResult(
            available=False,
            detail="Voice selection is MANUAL — user enters Voice ID",
        )
    if strategy == "STATIC":
        try:
            discovery = await adapter.discover_voices(provider)
            return OptionalFeatureResult(
                available=True,
                detail=f"STATIC catalog ({len(discovery.voices)} voices)",
            )
        except Exception as exc:
            return OptionalFeatureResult(available=False, detail=f"Static catalog unavailable: {exc}")

    # AUTO
    if settings.mock_mode or not settings.key_is_usable(provider.api_key):
        return OptionalFeatureResult(available=True, detail="Mock mode")

    try:
        discovery = await adapter.discover_voices(provider)
        return OptionalFeatureResult(
            available=True,
            detail=f"Voice discovery available (mode={discovery.mode}, {len(discovery.voices)} voices)",
        )
    except ProviderException as exc:
        return OptionalFeatureResult(
            available=False,
            detail=f"Voice discovery unavailable: {exc.message or str(exc)}",
        )
    except Exception as exc:
        return OptionalFeatureResult(
            available=False,
            detail=f"Voice discovery unavailable: {exc}",
        )


async def _probe_model_discovery(provider: ProviderPayload, adapter) -> OptionalFeatureResult:
    if adapter is None:
        return OptionalFeatureResult(
            available=False,
            detail=f"Model discovery not probed for protocol {provider.protocol}",
        )

    if settings.mock_mode or not settings.key_is_usable(provider.api_key):
        return OptionalFeatureResult(available=True, detail="Mock mode")

    try:
        result = await adapter.discover_models(provider)
        return OptionalFeatureResult(
            available=result.available,
            detail=result.detail,
        )
    except Exception as exc:
        return OptionalFeatureResult(
            available=False,
            detail=f"Model listing unavailable: {exc}",
        )


# ── Legacy helpers kept for tests that import private symbols ────────────────

# Tests historically imported ``_AUTH_HEADER_TEMPLATES``, ``_auth_probe_path``,
# and ``_normalize_base_url``. Rebuild from the live registry.

# Alias for tests / older call sites.
_normalize_base_url = normalize_base_url


def _auth_probe_path(protocol: str, base_url: str) -> str:
    adapter = get_adapter(protocol)
    if adapter is None:
        return ""
    return adapter.auth_probe_path(base_url)


def _build_auth_header_templates() -> dict[str, dict[str, str]]:
    from app.services.protocol import get_registry

    templates: dict[str, dict[str, str]] = {}
    for adapter in get_registry().adapters():
        # Materialize with a placeholder so tests can assert template shape.
        headers = adapter.auth_headers("{key}")
        templates[adapter.protocol] = headers
    return templates


# Eager snapshot for tests that iterate the dict at import/test time.
_AUTH_HEADER_TEMPLATES: dict[str, dict[str, str]] = _build_auth_header_templates()
