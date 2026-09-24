"""Text-to-speech gateway for the media pipeline.

Dispatches through the protocol adapter registry — no protocol-name branches.
"""
from __future__ import annotations

import base64
import io
import time
import uuid

from app.core.config import settings
from app.core.logging_config import get_internal_logger, get_frontend_logger
from app.schemas.contract import (
    CacheInfo,
    ExecutionInfo,
    TtsRequest,
    TtsResponse,
    TtsResult,
    TtsUsage,
    TtsVoicesResponse,
)
from app.services.generated_asset_cache import (
    NoopGeneratedAssetCache,
    SingleFlight,
    build_cache_key,
    get_cache,
)
from app.services.protocol import require_adapter
from app.services.protocol.types import TtsCacheDescriptor
from app.services.provider_errors import ProviderErrorCode, ProviderException

_int_log = get_internal_logger("tts_gateway")
_fe_log = get_frontend_logger("tts_gateway")

#: Per-process dedupe of concurrent same-key cache misses (ADR-CEP A2.1).
_SINGLE_FLIGHT = SingleFlight()

# Minimal valid silent-ish MP3 frame payload for mock mode (tiny MPEG frame).
_MOCK_MP3_B64 = (
    "//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICA"
    "gICAgICAgICAgICAgICAgICAgICAgIC//////////////////////////////////////////////////////////////////"
    "8AAAA5TEFNRTMuMTAwBK8AAAAAAAAAABUgJAUHQQAB9gAAAnGRsiyhAAAAAAAAAAAAAAAAAAAA//"
    "uQxAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV"
)


async def list_voices(provider) -> TtsVoicesResponse:
    """Return an authoritative, static, or fallback voice catalog for a protocol."""
    adapter = require_adapter(provider.protocol, capability="TTS")
    if _should_mock(provider, adapter):
        return _mock_voices(provider.protocol)

    discovery = await adapter.discover_voices(provider)
    mode = discovery.mode
    if mode not in ("AUTHORITATIVE", "STATIC", "FALLBACK", "UNAVAILABLE"):
        mode = "FALLBACK"
    return TtsVoicesResponse(
        protocol=provider.protocol,
        discovery_mode=mode,  # type: ignore[arg-type]
        voices=discovery.voices,
        voice_discovery_strategy=adapter.voice_discovery_strategy.value,
    )


def audio_duration_ms(audio: bytes) -> int | None:
    """Decode the clip (any ffmpeg-readable provider format) and return its length.

    Spring lays narration on the output timeline from this measurement, so it
    must not depend on the provider returning WAV. ``None`` when undecodable.
    """
    if not audio:
        return None
    try:
        from pydub import AudioSegment

        return len(AudioSegment.from_file(io.BytesIO(audio)))
    except Exception:  # noqa: BLE001 - measurement is best-effort metadata
        return None


async def synthesize(request: TtsRequest) -> TtsResponse:
    """Synthesize a batch by dispatching through the configured protocol adapter.

    A2.1: every segment runs through the Generated Asset Cache (lookup → hit /
    miss → synthesize → store). The adapter's ``cache_descriptor`` is resolved
    first so the voice/capability fail-fast gates run even on cache hits (P0-2),
    and the key material is available before any engine call. The cache is
    fail-open — a Noop or a failing cache degrades to live synthesis.
    """
    adapter = require_adapter(request.provider.protocol, capability="TTS")
    if _should_mock(request.provider, adapter):
        return _mock_response(request)

    results: list[TtsResult] = []
    total_characters = 0
    first_provider_error: dict | None = None

    for segment in request.segments:
        started = time.monotonic()
        try:
            audio, cache_hit, source = await _synthesize_one(
                adapter, request.provider, request.voice_id, segment.target_text
            )
            latency_ms = int((time.monotonic() - started) * 1000)
            request_id = uuid.uuid4().hex
            results.append(
                TtsResult(
                    segment_id=segment.segment_id,
                    status="SUCCESS",
                    audio_ref=None,
                    audio_base64=base64.b64encode(audio).decode("ascii"),
                    duration_ms=audio_duration_ms(audio),
                    execution_info=_execution_info(
                        adapter,
                        request.provider,
                        request.voice_id,
                        request_id,
                        latency_ms,
                        cache_hit=cache_hit,
                        source=source,
                    ),
                )
            )
            total_characters += len(segment.target_text)
        except ProviderException as exc:
            if first_provider_error is None:
                first_provider_error = exc.to_error_detail()
                first_provider_error["model"] = first_provider_error.get("model") or request.provider.model
                first_provider_error["capability"] = first_provider_error.get("capability") or "TTS"
            _fe_log.warning(
                "TTS segment %s failed: errorCode=%s",
                segment.segment_id,
                exc.code,
                extra={
                    "errorCode": exc.code,
                    "provider": exc.provider,
                    "protocol": exc.protocol,
                    "capability": exc.capability,
                    "retryable": exc.retryable,
                },
            )
            results.append(
                TtsResult(
                    segment_id=segment.segment_id,
                    status="FAILED",
                    error=exc.message,
                    errorCode=exc.code.value,
                )
            )
        except Exception as exc:
            _int_log.exception("TTS failed for segment %s", segment.segment_id)
            if first_provider_error is None:
                unknown = ProviderException(
                    ProviderErrorCode.PROVIDER_UNKNOWN,
                    "TTS synthesis failed",
                    protocol=request.provider.protocol,
                    capability="TTS",
                    model=request.provider.model,
                )
                first_provider_error = unknown.to_error_detail()
                first_provider_error["model"] = first_provider_error.get("model") or request.provider.model
                first_provider_error["capability"] = first_provider_error.get("capability") or "TTS"
            results.append(
                TtsResult(
                    segment_id=segment.segment_id,
                    status="FAILED",
                    error="TTS synthesis failed",
                    errorCode=ProviderErrorCode.PROVIDER_UNKNOWN.value,
                )
            )

    success = [result for result in results if result.status == "SUCCESS"]
    return TtsResponse(
        correlation_id=request.correlation_id,
        status="COMPLETED" if success else "FAILED",
        results=results,
        usage=TtsUsage(
            characters=total_characters,
            provider=request.provider.protocol,
        ),
        error=None if success else "All segments failed TTS synthesis",
        error_detail=first_provider_error if not success else None,
    )


async def _synthesize_one(adapter, provider, voice_id: str, text: str) -> tuple[bytes, bool, str | None]:
    """One segment through the cache (or straight to the adapter when Noop).

    Lock ordering (A2.1 P1): acquire the per-key lock, THEN re-check the cache
    inside the lock, synthesize on a genuine miss, store, release. Concurrent
    same-key requests perform exactly one engine call in this process; the
    adapter gates (capability + voice catalog) already ran in ``cache_descriptor``
    before the lock so a cache hit can never bypass them.
    """
    cache = get_cache()
    descriptor = _descriptor(adapter, provider, voice_id)
    material = build_cache_key(provider, descriptor, voice_id, text)
    if isinstance(cache, NoopGeneratedAssetCache):
        synth = await adapter.synthesize(provider, text, voice_id)
        return synth.audio_bytes, False, None

    async def _run() -> tuple[bytes, bool, str | None]:
        try:
            cached = await cache.get(material)
        except Exception:
            _int_log.exception("Generated asset cache get failed for %s", material.hash)
            cached = None
        if cached is not None:
            return cached, True, cache.object_key(material)
        synth = await adapter.synthesize(provider, text, voice_id)
        try:
            await cache.put(material, synth.audio_bytes)
        except Exception:
            _int_log.exception("Generated asset cache put failed for %s", material.hash)
        return synth.audio_bytes, False, None

    return await _SINGLE_FLIGHT.run(material.hash, _run)


def _descriptor(adapter, provider, voice_id: str) -> TtsCacheDescriptor:
    """Pre-synthesis descriptor with the fail-fast gates; default for fakes/legacy."""
    resolver = getattr(adapter, "cache_descriptor", None)
    if resolver is not None:
        return resolver(provider, voice_id)
    return TtsCacheDescriptor(
        resolved_model=provider.model,
        mime_type="audio/mpeg",
        extension="mp3",
        speed="1.0",
    )


def _execution_info(
    adapter,
    provider,
    voice_id: str,
    request_id: str,
    latency_ms: int,
    *,
    cache_hit: bool,
    source: str | None,
) -> ExecutionInfo:
    """Build the per-segment execution_info (ADR-CEP §9, A2.1).

    On a cache hit the adapter was never invoked, so provider/model/voice come
    from the pre-synthesis descriptor; on a miss the engine metadata is used.
    Never includes the API key (TC-SEC-01).
    """
    descriptor = _descriptor(adapter, provider, voice_id)
    if not cache_hit:
        return ExecutionInfo(
            provider=provider.protocol,
            model=descriptor.resolved_model,
            voice=voice_id,
            cache=CacheInfo(hit=False, source=None),
            latency_ms=latency_ms,
            request_id=request_id,
        )
    return ExecutionInfo(
        provider=provider.protocol,
        model=descriptor.resolved_model,
        voice=voice_id,
        cache=CacheInfo(hit=True, source=source),
        latency_ms=latency_ms,
        request_id=request_id,
    )


def _should_mock(provider, adapter) -> bool:
    """Mock when in mock mode, or when a key-requiring adapter has no usable key.

    Zero-key adapters (``adapter.requires_api_key = False``, e.g.
    local_piper) are never gated on ``api_key`` — an empty key is their
    normal operating mode, not a misconfiguration (P0-1 fix).
    """
    if settings.mock_mode:
        return True
    if adapter.requires_api_key:
        return not settings.key_is_usable(provider.api_key)
    return False


def _mock_response(request: TtsRequest) -> TtsResponse:
    results = [
        TtsResult(
            segment_id=segment.segment_id,
            status="SUCCESS",
            audio_ref=None,
            audio_base64=_MOCK_MP3_B64,
        )
        for segment in request.segments
    ]
    characters = sum(len(segment.target_text) for segment in request.segments)
    return TtsResponse(
        correlation_id=request.correlation_id,
        status="COMPLETED" if results else "FAILED",
        results=results,
        usage=TtsUsage(
            characters=characters,
            provider=request.provider.protocol,
        ),
    )


def _mock_voices(protocol: str) -> TtsVoicesResponse:
    from app.schemas.contract import TtsVoice

    return TtsVoicesResponse(
        protocol=protocol,
        discovery_mode="FALLBACK",
        voices=[
            TtsVoice(
                voice_id="vi-female-01",
                language="vi-VN",
                gender="FEMALE",
                display_name="Mai",
            ),
            TtsVoice(
                voice_id="vi-male-01",
                language="vi-VN",
                gender="MALE",
                display_name="Nam",
            ),
        ],
    )
