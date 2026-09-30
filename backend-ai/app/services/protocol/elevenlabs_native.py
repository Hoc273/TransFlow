"""ElevenLabs native protocol adapter (TTS + STT + AUTO voice discovery).

One key serves both: TTS on ``/text-to-speech/{voice}`` with an ``eleven_*``
model, STT (Scribe) on ``/speech-to-text`` with a ``scribe_*`` model. A key row
carries one default model, so each capability falls back to its own default
when the configured model belongs to the other family.
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload, TtsVoice
from app.services.protocol.adapter import ProtocolAdapter
from app.services.protocol.http_utils import join_url, raise_for_http_status
from app.services.protocol.language_codes import normalize_language
from app.services.protocol.speech_stt import TimedWord, detected_language, is_auto_language, segments_from_words
from app.services.protocol.types import (
    AudioInput,
    Capability,
    TranscribeResult,
    TtsCacheDescriptor,
    SynthesizeResult,
    ValidationPhaseResult,
    VoiceDiscoveryResult,
    VoiceDiscoveryStrategy,
)
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderTransport,
    ProviderValidation,
)

_prov_log = get_provider_logger("adapter.elevenlabs")

DEFAULT_TTS_MODEL = "eleven_multilingual_v2"
DEFAULT_STT_MODEL = "scribe_v1"


def tts_model(model: Optional[str]) -> str:
    """The configured model when it is a TTS model, else the TTS default."""
    value = (model or "").strip()
    return value if value and not value.startswith("scribe") else DEFAULT_TTS_MODEL


def stt_model(model: Optional[str]) -> str:
    """The configured model when it is a Scribe (STT) model, else the STT default."""
    value = (model or "").strip()
    return value if value.startswith("scribe") else DEFAULT_STT_MODEL

# GET /voices page size (provider maximum) and a hard loop cap so a broken
# ``next_page_token`` can never spin forever. The catalog must be fetched in
# FULL: the AUTHORITATIVE cache synchronize is provider-scoped, and feeding it
# a truncated list would soft-deactivate voices of other languages.
_PAGE_SIZE = 100
_MAX_PAGES = 100

# Legacy deployments / proxies may return voices whose only language hint is a
# human-readable ``labels.language`` word instead of an ISO code. Conservative
# alias table for the words ElevenLabs actually uses — anything not listed and
# not already ISO-like stays unknown (never guessed).
_LABEL_LANGUAGE_ALIASES = {
    "english": "en",
    "vietnamese": "vi",
    "japanese": "ja",
    "korean": "ko",
    "chinese": "zh",
    "mandarin": "zh",
    "cantonese": "zh",
    "spanish": "es",
    "portuguese": "pt",
    "french": "fr",
    "german": "de",
    "italian": "it",
    "russian": "ru",
    "hindi": "hi",
    "arabic": "ar",
    "dutch": "nl",
    "polish": "pl",
    "turkish": "tr",
    "indonesian": "id",
    "thai": "th",
    "ukrainian": "uk",
    "swedish": "sv",
    "norwegian": "no",
    "danish": "da",
    "finnish": "fi",
}


def _voice(
    voice_id: str,
    display_name: str | None = None,
    language: str | None = None,
    gender: str | None = None,
    languages: list[str] | None = None,
) -> TtsVoice:
    normalized_gender = "MALE" if (gender or "").upper() == "MALE" else "FEMALE"
    if languages:
        resolved = list(languages)
    else:
        primary = normalize_language(language)
        resolved = [primary] if primary else ["und"]
    return TtsVoice(
        voice_id=voice_id,
        language=resolved[0],
        languages=resolved,
        gender=normalized_gender,
        display_name=display_name or voice_id,
    )


def _label_language(raw: str | None) -> str | None:
    """labels.language → normalized code, tolerating human-readable words."""
    normalized = normalize_language(raw)
    if normalized:
        return normalized
    return _LABEL_LANGUAGE_ALIASES.get((raw or "").strip().lower())


def _verified_languages(item: dict) -> list[str]:
    """Priority 1: provider-verified per-voice language compatibility.

    Accepts both wire generations of the field entries — v1 uses
    ``language_code``, v2 uses ``language``.
    """
    verified = item.get("verified_languages")
    if not isinstance(verified, list):
        return []
    codes: list[str] = []
    for entry in verified:
        if not isinstance(entry, dict):
            continue
        raw = entry.get("language_code") or entry.get("language")
        code = normalize_language(raw)
        if code and code not in codes:
            codes.append(code)
    return codes


def _extract_voice_languages(item: dict) -> list[str]:
    """Compatibility priority: verified_languages > labels.language > unknown."""
    labels = item.get("labels") or {}
    codes = _verified_languages(item)
    if codes:
        return codes
    labeled = _label_language(labels.get("language"))
    return [labeled] if labeled else []


class ElevenLabsNativeAdapter(ProtocolAdapter):
    protocol = "elevenlabs_native"
    supported_capabilities = frozenset({Capability.TTS.value, Capability.STT.value})
    voice_discovery_strategy = VoiceDiscoveryStrategy.AUTO

    def auth_headers(self, api_key: str) -> dict[str, str]:
        return {"xi-api-key": api_key}

    def auth_probe_path(self, base_url: str) -> str:
        return "/voices"

    async def synthesize(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        self.require_provider_capability(provider, Capability.TTS)
        payload = {"text": text, "model_id": tts_model(provider.model)}
        headers = {
            **self.auth_headers(provider.api_key),
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                response = await client.post(
                    join_url(provider.base_url, f"/text-to-speech/{quote(voice_id, safe='')}"),
                    headers=headers,
                    json=payload,
                )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            ) from exc

        raise_for_http_status(
            response, provider, operation="speech synthesis", capability="TTS", log=_prov_log
        )
        if not response.content:
            raise ProviderValidation(
                "TTS provider returned empty audio",
                code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            )
        return SynthesizeResult(
            audio_bytes=response.content,
            mime_type="audio/mpeg",
            metadata={"format": "mp3"},
        )

    async def discover_voices(self, provider: ProviderPayload) -> VoiceDiscoveryResult:
        """Full-catalog discovery across all pages.

        GET /voices is paginated by the provider (``page_size`` +
        ``has_more``/``next_page_token``); a single unpaginated call truncates
        the catalog and — combined with the provider-scoped AUTHORITATIVE cache
        synchronize — would soft-deactivate every language beyond page one.
        There is no reliable server-side language filter on this endpoint, so
        completeness comes from following the page tokens to exhaustion.
        """
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                voices: list[TtsVoice] = []
                next_page_token: str | None = None
                for _ in range(_MAX_PAGES):
                    params: dict[str, object] = {"page_size": _PAGE_SIZE}
                    if next_page_token:
                        params["next_page_token"] = next_page_token
                    response = await client.get(
                        join_url(provider.base_url, "/voices"),
                        headers=self.auth_headers(provider.api_key),
                        params=params,
                    )
                    raise_for_http_status(
                        response,
                        provider,
                        operation="voice discovery",
                        capability="TTS",
                        log=_prov_log,
                    )
                    data = response.json()
                    for item in data.get("voices", []):
                        voice_id = item.get("voice_id")
                        if not voice_id:
                            continue
                        languages = _extract_voice_languages(item)
                        primary = languages[0] if languages else None
                        voices.append(
                            _voice(
                                voice_id,
                                item.get("name"),
                                primary,
                                (item.get("labels") or {}).get("gender"),
                                languages=languages or None,
                            )
                        )
                    if not data.get("has_more"):
                        break
                    next_page_token = data.get("next_page_token")
                    if not next_page_token:
                        break
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            ) from exc

        return VoiceDiscoveryResult(
            strategy=self.voice_discovery_strategy,
            mode="AUTHORITATIVE",
            voices=voices,
            detail=f"{len(voices)} voices from ElevenLabs /voices",
        )

    async def validate_capability(
        self,
        provider: ProviderPayload,
        capability: str,
    ) -> ValidationPhaseResult:
        if capability == Capability.STT.value:
            return ValidationPhaseResult(
                ok=True,
                message="STT capability declared; use stt-probe for live check",
            )
        if capability != Capability.TTS.value:
            return ValidationPhaseResult(
                ok=False,
                message=f"Protocol {self.protocol} does not support {capability}",
            )
        return ValidationPhaseResult(
            ok=True,
            message="TTS capability declared; use tts-probe for live check",
        )

    def cache_descriptor(self, provider: ProviderPayload, voice_id: str) -> TtsCacheDescriptor:
        return TtsCacheDescriptor(
            resolved_model=tts_model(provider.model),
            mime_type="audio/mpeg",
            extension="mp3",
            speed="1.0",
        )

    # ── STT (Scribe) ─────────────────────────────────────────────────────────

    async def transcribe(
        self,
        provider: ProviderPayload,
        audio: AudioInput,
        *,
        source_lang: Optional[str] = None,
    ) -> TranscribeResult:
        self.require_provider_capability(provider, Capability.STT)
        try:
            file_bytes = audio.as_bytes()
        except ValueError as exc:
            raise ProviderValidation(
                "ElevenLabs STT requires local audio bytes",
                code=ProviderErrorCode.PROVIDER_BAD_REQUEST,
                protocol=provider.protocol,
                capability="STT",
            ) from exc
        data = {
            "model_id": stt_model(provider.model),
            "timestamps_granularity": "word",
            "tag_audio_events": "false",
        }
        language = None if is_auto_language(source_lang) else normalize_language(source_lang)
        if language:
            data["language_code"] = language
        try:
            async with httpx.AsyncClient(timeout=max(settings.request_timeout_seconds, 600.0)) as client:
                response = await client.post(
                    join_url(provider.base_url, "/speech-to-text"),
                    headers=self.auth_headers(provider.api_key),
                    data=data,
                    files={"file": (audio.filename or "audio.wav", file_bytes, audio.mime_type or "audio/wav")},
                )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            ) from exc

        raise_for_http_status(response, provider, operation="transcription", capability="STT", log=_prov_log)
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderValidation(
                "ElevenLabs STT returned a non-JSON response",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            ) from exc
        return parse_scribe_transcript(payload)


# Scripts written without spaces between words: Scribe returns no ``spacing``
# tokens there, so words are joined directly.
_NO_SPACE_LANGUAGES = {"zh", "ja", "th", "lo", "km", "my"}


def parse_scribe_transcript(payload: object) -> TranscribeResult:
    """Scribe JSON (word timings in seconds) -> sentence-level segments."""
    if not isinstance(payload, dict) or not isinstance(payload.get("words", []), list):
        raise ProviderValidation(
            "ElevenLabs STT response has an unsupported shape",
            code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
            protocol="elevenlabs_native",
            capability="STT",
        )
    words: list[TimedWord] = []
    for item in payload.get("words") or []:
        if not isinstance(item, dict) or item.get("type", "word") != "word":
            continue
        start, end = item.get("start"), item.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        words.append(TimedWord(text=str(item.get("text") or ""), start_ms=int(start * 1000), end_ms=int(end * 1000)))
    detected = detected_language(payload.get("language_code"))
    segments = segments_from_words(words, joiner="" if detected in _NO_SPACE_LANGUAGES else " ")
    return TranscribeResult(
        segments=segments,
        detected_lang=detected,
        audio_seconds=segments[-1].end_ms / 1000.0 if segments else 0.0,
    )
