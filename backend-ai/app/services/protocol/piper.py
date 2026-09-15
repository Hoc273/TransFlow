"""Piper TTS adapter — System tier, zero-key local TTS (ADR-CEP §8, Phase A1.2).

Bundles MIT-licensed rhasspy/piper-voices v1.0.0 models (the 6 voices seeded
by Spring Boot V32, all verified to exist upstream) inside the Docker image
via ``piper/download_voices.py``. Model files are **never** downloaded at
runtime; missing model files fail fast with ``PROVIDER_TTS_VOICE_NOT_FOUND``.

Zero-key design: ``requires_api_key = False`` so the gateway never mocks or
gates Piper on ``api_key`` presence (unlike BYOK Google/Azure).

Discovery contract: ``discover_voices`` returns the **intersection** of the
system catalog (V32 seed) and the model files actually baked into
``PIPER_VOICES_DIR`` — no phantom voices, no unverified community forks.

The ``piper-tts`` package is imported lazily so unit tests and non-TTS
deployments do not require it. Synthesis is serialized through a module-level
``asyncio.Semaphore`` (``PIPER_SEMAPHORE``, default 2) because ONNX inference
is CPU-bound; both lazy model load and the blocking synthesis call run in
worker threads via ``asyncio.to_thread`` (never block the event loop).
"""
from __future__ import annotations

import asyncio
import io
import threading
import wave
from dataclasses import replace
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.schemas.contract import ProviderPayload, TtsVoice
from app.services.protocol.base_tts import BaseTtsAdapter
from app.services.protocol.static_voices import PIPER_VOICE_MODELS, PIPER_VOICES
from app.services.protocol.types import (
    Capability,
    SynthesizeResult,
    TtsCacheDescriptor,
    VoiceDiscoveryResult,
)
from app.services.provider_errors import ProviderErrorCode, ProviderValidation

#: Concurrency cap for ONNX synthesis (CPU-bound).
_PIPER_SEMAPHORE: asyncio.Semaphore = asyncio.Semaphore(max(1, settings.piper_semaphore))

#: Loaded models by model stem; guards duplicated loads across concurrent calls.
_LOADER_LOCK = threading.Lock()
_MODEL_CACHE: dict[str, Any] = {}


def _find_model_files(model_stem: str) -> tuple[Path, Path]:
    """Locate ``{stem}.onnx`` and ``{stem}.onnx.json`` under PIPER_VOICES_DIR."""
    root = Path(settings.piper_voices_dir)
    onnx = next(root.rglob(f"{model_stem}.onnx"), None) if root.is_dir() else None
    if onnx is None:
        raise ProviderValidation(
            f"Piper model '{model_stem}' is not bundled (missing {model_stem}.onnx)",
            code=ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND,
            protocol="local_piper",
            capability=Capability.TTS.value,
        )
    json_cfg = Path(str(onnx) + ".json")
    if not json_cfg.is_file():
        raise ProviderValidation(
            f"Piper model '{model_stem}' is bundled without its {model_stem}.onnx.json config",
            code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
            protocol="local_piper",
            capability=Capability.TTS.value,
        )
    return onnx, json_cfg


def _bundled_model_stems() -> set[str]:
    """Stems of all bundled ``*.onnx`` files under PIPER_VOICES_DIR."""
    root = Path(settings.piper_voices_dir)
    if not root.is_dir():
        return set()
    return {p.stem for p in root.rglob("*.onnx")}


def _load_piper_voice(model_stem: str) -> Any:
    """Lazy-import piper-tts and load (cache) a voice. Not called at import.

    Runs inside ``asyncio.to_thread`` (see ``_synthesize_engine``) so the
    blocking ONNX load never stalls the event loop. The cache is checked
    before touching the filesystem so repeated synthesis does not re-scan
    PIPER_VOICES_DIR; the import stays inside the function so environments
    without piper-tts can still import the adapter.
    """
    with _LOADER_LOCK:
        cached = _MODEL_CACHE.get(model_stem)
        if cached is not None:
            return cached

    from piper import PiperVoice  # noqa: PLC0415 — installed only in the image

    onnx, json_cfg = _find_model_files(model_stem)
    with _LOADER_LOCK:
        cached = _MODEL_CACHE.get(model_stem)
        if cached is not None:  # another coroutine loaded it meanwhile
            return cached
        voice = PiperVoice.load(onnx, config_path=json_cfg)
        _MODEL_CACHE[model_stem] = voice
        return voice


class PiperAdapter(BaseTtsAdapter):
    protocol = "local_piper"
    supported_capabilities = frozenset({Capability.TTS.value})
    default_probe_voice = "piper-vi-vais1000"

    #: Zero-key System-tier adapter — gateway must not mock/gate on api_key.
    requires_api_key = False

    # No API key, no remote endpoint — auth probe is trivially accepted.
    def auth_headers(self, api_key: str) -> dict[str, str]:
        return {}

    def auth_probe_path(self, base_url: str) -> str:
        return ""

    async def discover_voices(
        self,
        provider: ProviderPayload,
    ) -> VoiceDiscoveryResult:
        """Intersection of the system catalog (V32 seed) with bundled models.

        A seeded voice whose model files are missing from the image is
        dropped from discovery (and from the probe), so the FE can never
        select a voice that would fail at synthesis time. Missing models
        still fail fast with ``PROVIDER_TTS_VOICE_NOT_FOUND`` if requested
        directly.
        """
        bundled = _bundled_model_stems()
        available: list[TtsVoice] = [
            voice
            for voice in PIPER_VOICES
            if PIPER_VOICE_MODELS.get(voice.voice_id) in bundled
        ]
        return VoiceDiscoveryResult(
            strategy=self.voice_discovery_strategy,
            mode="STATIC",
            voices=available,
            detail=(
                f"{len(available)}/{len(PIPER_VOICES)} seeded Piper voices "
                f"bundled in {settings.piper_voices_dir}"
            ),
        )

    def cache_descriptor(
        self,
        provider: ProviderPayload,
        voice_id: str,
    ) -> TtsCacheDescriptor:
        """Cache key material for Piper: resolved model = bundled ONNX stem.

        Inherits the capability + voice gates from ``BaseTtsAdapter`` (a cache
        hit can never bypass the fail-fast gates), then resolves the model that
        will actually execute (``PIPER_VOICE_MODELS``) and the WAV output
        format. Pure, no I/O.
        """
        descriptor = super().cache_descriptor(provider, voice_id)
        model_stem = PIPER_VOICE_MODELS.get(voice_id)
        if model_stem is None:
            raise ProviderValidation(
                f"No Piper model mapping for voice '{voice_id}'",
                code=ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND,
                protocol=self.protocol,
                capability=Capability.TTS.value,
            )
        return replace(
            descriptor,
            resolved_model=model_stem,
            mime_type="audio/wav",
            extension="wav",
        )

    async def _synthesize_engine(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        model_stem = PIPER_VOICE_MODELS.get(voice_id)
        if model_stem is None:
            raise ProviderValidation(
                f"No Piper model mapping for voice '{voice_id}'",
                code=ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND,
                protocol=self.protocol,
                capability=Capability.TTS.value,
            )
        # Lazy load is blocking (ONNX) — off the event loop, under the semaphore.
        async with _PIPER_SEMAPHORE:
            voice = await asyncio.to_thread(_load_piper_voice, model_stem)
            wav_bytes, sample_rate = await asyncio.to_thread(
                _synthesize_wav_sync, voice, text
            )
        return SynthesizeResult(
            audio_bytes=wav_bytes,
            mime_type="audio/wav",
            sample_rate=sample_rate,
            metadata={"format": "wav", "model": model_stem},
        )

    def _with_execution_info(
        self,
        provider: ProviderPayload,
        voice_id: str,
        engine_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        # Report the bundled ONNX model stem as the executed model.
        return super()._with_execution_info(
            provider, voice_id, engine_metadata,
            model=PIPER_VOICE_MODELS.get(voice_id),
        )


def _synthesize_wav_sync(voice: Any, text: str) -> tuple[bytes, int]:
    """Synthesize into a real ``wave.Wave_write`` (P0-2 fix).

    piper-tts changed its writer API across 1.x (``>=1.2,<2`` in
    requirements.txt, image installs latest):

    * ``>=1.3/1.6`` — ``synthesize_wav(text, wav_file, set_wav_format=True)``
      expects an open ``wave.Wave_write`` and sets the format itself; plain
      ``synthesize()`` returns an ``AudioChunk`` generator (passing a writer
      there would silently produce nothing).
    * ``1.2`` (rhasspy) — ``synthesize(text, wav_file)`` writes directly and
      ``synthesize_wav`` re-opens the file itself.

    The writer is backed by an in-memory buffer; the model's real
    ``sample_rate`` from ``voice.config`` is returned so the gateway can
    report true audio metadata instead of a hardcoded 22050.
    """
    import inspect

    sample_rate = int(voice.config.sample_rate)
    buffer = io.BytesIO()
    synth_wav = getattr(voice, "synthesize_wav", None)
    if synth_wav is not None and "set_wav_format" in str(inspect.signature(synth_wav)):
        with wave.open(buffer, "wb") as wav_file:
            synth_wav(text, wav_file)
    else:
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            voice.synthesize(text, wav_file)
    return buffer.getvalue(), sample_rate
