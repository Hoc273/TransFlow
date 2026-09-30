"""Azure Speech adapter — TTS and STT on one Speech resource key.

REST ``cognitiveservices/v1`` with an ``Ocp-Apim-Subscription-Key`` header and
an SSML body; audio comes back as raw MP3 bytes. Voices are discovered live from
``cognitiveservices/voices/list`` (also the phase-2 auth probe: 200 with a valid
key, 401 without).

The Azure Portal shows ``https://{region}.api.cognitive.microsoft.com/`` as the
resource endpoint, but that host answers 404 for every TTS REST call — synthesis
and voice listing only live on ``https://{region}.tts.speech.microsoft.com``.
``speech_base_url`` maps the portal endpoint so users can paste it as-is.

STT uses Fast Transcription (``speechtotext/transcriptions:transcribe``), which
lives on the opposite host: the portal endpoint (or a custom
``*.cognitiveservices.azure.com`` domain), never ``*.tts.speech``.
``stt_base_url`` maps a TTS host back, so one key row with one base URL serves
both capabilities. Neither API takes a model: the key's model is only a label.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from typing import Optional
from urllib.parse import urlsplit
from xml.sax.saxutils import escape as xml_escape

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload, SttSegment, TtsVoice
from app.services.protocol.base_tts import BaseTtsAdapter
from app.services.protocol.http_utils import join_url, raise_for_http_status
from app.services.protocol.language_codes import normalize_language, normalize_languages
from app.services.protocol.speech_stt import (
    MAX_SEGMENT_MS,
    TimedWord,
    is_auto_language,
    locale_for,
    split_at_widest_gaps,
)
from app.services.protocol.types import (
    AudioInput,
    Capability,
    TranscribeResult,
    SynthesizeResult,
    VoiceDiscoveryResult,
    VoiceDiscoveryStrategy,
)
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderTransport,
    ProviderValidation,
)

_prov_log = get_provider_logger("adapter.azure_speech")

_PORTAL_HOST_RE = re.compile(r"^(?P<region>[a-z0-9]+)\.api\.cognitive\.microsoft\.com$")
_SPEECH_HOST_SUFFIX = ".tts.speech.microsoft.com"
_SPEECH_HOST_RE = re.compile(r"^(?P<region>[a-z0-9]+)\.(?:tts|stt)\.speech\.microsoft\.com$")
_TRANSCRIBE_PATH = "/speechtotext/transcriptions:transcribe"
_TRANSCRIBE_API_VERSION = "2024-11-15"
# Auto source language: Fast Transcription identifies the language among these
# candidates (the multilingual model behind ``locales: []`` has no Vietnamese).
_AUTO_CANDIDATE_LOCALES = (
    "en-US", "vi-VN", "zh-CN", "ja-JP", "ko-KR", "fr-FR", "de-DE", "es-ES", "th-TH", "id-ID",
)
# Azure short names start ``{lang}-{Upper…}``: ``en-US-JennyNeural``,
# ``zh-CN-shaanxi-XiaoniNeural``, ``en-US-Ava:DragonHDLatestNeural``,
# ``de-DE-Klaus:MAI-Voice-2-Flash``, ``en-Multitalker:DragonHDLatestNeural``; the
# ``Name:Model`` HD family also ships lowercase ids (``en-us-ava:DragonHDOmniLatestNeural``).
# Anything else (``alloy``, ``not-a-real-voice``) can never be an Azure voice.
_VOICE_ID_RE = re.compile(
    # ``\w`` is Unicode-aware: persona names carry accents (``hu-HU-Réka:MAI-Voice-2``).
    r"^[a-z]{2,3}-(?:[A-Z0-9][\w:.-]{1,100}|[\w.-]{1,60}:[\w:.-]{1,60})$"
)
_LOCALE_RE = re.compile(r"^([a-z]{2,3})(?:-([A-Za-z]{2}|[0-9]{3})(?=-|:|$))?")
_VOICES_LIST_PATH = "/cognitiveservices/voices/list"


def speech_base_url(base_url: str) -> str:
    """Resolve the host that actually serves Azure TTS REST for ``base_url``."""
    raw = (base_url or "").strip()
    parts = urlsplit(raw)
    host = (parts.hostname or "").lower()
    match = _PORTAL_HOST_RE.match(host)
    if match:
        return f"https://{match.group('region')}{_SPEECH_HOST_SUFFIX}"
    if host.endswith(_SPEECH_HOST_SUFFIX):
        # Users also paste the full synthesis URL; the adapter appends paths itself.
        return f"{parts.scheme or 'https'}://{host}"
    return raw.rstrip("/")


def stt_base_url(base_url: str) -> str:
    """Resolve the host that serves Azure Fast Transcription for ``base_url``."""
    raw = (base_url or "").strip()
    parts = urlsplit(raw)
    host = (parts.hostname or "").lower()
    match = _SPEECH_HOST_RE.match(host)
    if match:
        return f"https://{match.group('region')}.api.cognitive.microsoft.com"
    if host:
        # Portal endpoint or custom domain: the adapter appends the path itself.
        return f"{parts.scheme or 'https'}://{host}"
    return raw.rstrip("/")


_STATUS_MAP = {"ga": "GA", "preview": "PREVIEW", "deprecated": "DEPRECATED"}


def _display_name(item: dict, voice_id: str) -> str:
    """``LocalName`` when it is Latin script ("Hoài My"), else the romanized
    ``DisplayName`` ("Xiaoxiao" over "晓晓") so every user can read it."""
    local = (item.get("LocalName") or "").strip()
    if local and all(ord(ch) <= 0x024F or ch.isspace() for ch in local):
        return local
    return (item.get("DisplayName") or "").strip() or local or voice_id


def _locale_of(voice_id: str) -> str:
    """``xml:lang`` for a voice: ``lang-REGION`` when the id carries a region, else ``lang``."""
    match = _LOCALE_RE.match(voice_id)
    if not match:
        return "en-US"
    lang, region = match.groups()
    return f"{lang}-{region.upper()}" if region else lang


class AzureSpeechAdapter(BaseTtsAdapter):
    protocol = "azure_speech"
    supported_capabilities = frozenset({Capability.TTS.value, Capability.STT.value})
    default_probe_voice = "vi-VN-HoaiMyNeural"
    voice_discovery_strategy = VoiceDiscoveryStrategy.AUTO

    # ── Auth ─────────────────────────────────────────────────────────────────

    def auth_headers(self, api_key: str) -> dict[str, str]:
        return {"Ocp-Apim-Subscription-Key": api_key}

    def auth_probe_path(self, base_url: str) -> str:
        return _VOICES_LIST_PATH

    def auth_probe_url(self, base_url: str) -> str:
        return join_url(speech_base_url(base_url), _VOICES_LIST_PATH)

    # ── Voices ───────────────────────────────────────────────────────────────

    def ensure_voice_known(self, voice_id: str) -> None:
        """Azure publishes hundreds of voices per region; the live catalog is the
        authority, so only reject ids that cannot be an Azure short name."""
        if _VOICE_ID_RE.match(voice_id or ""):
            return
        super().ensure_voice_known(voice_id)

    async def discover_voices(self, provider: ProviderPayload) -> VoiceDiscoveryResult:
        url = join_url(speech_base_url(provider.base_url), _VOICES_LIST_PATH)
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                response = await client.get(url, headers=self.auth_headers(provider.api_key))
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            ) from exc

        raise_for_http_status(
            response, provider, operation="voice discovery", capability="TTS", log=_prov_log
        )
        voices: list[TtsVoice] = []
        for item in response.json() or []:
            voice_id = (item.get("ShortName") or "").strip()
            locale = (item.get("Locale") or "").strip()
            if not voice_id or not locale:
                continue
            gender = (item.get("Gender") or "").upper()
            status = _STATUS_MAP.get((item.get("Status") or "").strip().lower(), "GA")
            voices.append(
                TtsVoice(
                    voice_id=voice_id,
                    language=locale,
                    languages=normalize_languages([locale, *(item.get("SecondaryLocaleList") or [])]) or None,
                    gender=gender if gender in ("MALE", "FEMALE") else None,
                    display_name=_display_name(item, voice_id),
                    status=status,
                )
            )
        return VoiceDiscoveryResult(
            strategy=self.voice_discovery_strategy,
            mode="AUTHORITATIVE",
            voices=voices,
            detail=f"{len(voices)} voices from Azure voices/list",
        )

    # ── TTS ──────────────────────────────────────────────────────────────────

    async def _synthesize_engine(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        ssml = (
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' "
            f"xml:lang='{xml_escape(_locale_of(voice_id))}'>"
            f"<voice name='{xml_escape(voice_id)}'>{xml_escape(text)}</voice></speak>"
        )
        headers = {
            **self.auth_headers(provider.api_key),
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        }
        url = join_url(speech_base_url(provider.base_url), "/cognitiveservices/v1")
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                response = await client.post(url, headers=headers, content=ssml)
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
                "Azure TTS returned empty audio",
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

    # ── STT (Fast Transcription) ─────────────────────────────────────────────

    async def transcribe(
        self,
        provider: ProviderPayload,
        audio: AudioInput,
        *,
        source_lang: Optional[str] = None,
    ) -> TranscribeResult:
        self.require_provider_capability(provider, Capability.STT)
        locale = locale_for(source_lang)
        if locale is None and not is_auto_language(source_lang):
            raise ProviderValidation(
                f"Azure STT has no locale for source language {source_lang!r}",
                code=ProviderErrorCode.PROVIDER_BAD_REQUEST,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            )
        definition = {"locales": [locale] if locale else list(_AUTO_CANDIDATE_LOCALES)}
        url = join_url(stt_base_url(provider.base_url), _TRANSCRIBE_PATH)
        try:
            file_bytes = audio.as_bytes()
        except ValueError as exc:
            raise ProviderValidation(
                "Azure STT requires local audio bytes",
                code=ProviderErrorCode.PROVIDER_BAD_REQUEST,
                protocol=provider.protocol,
                capability="STT",
            ) from exc
        try:
            async with httpx.AsyncClient(timeout=max(settings.request_timeout_seconds, 600.0)) as client:
                response = await client.post(
                    url,
                    params={"api-version": _TRANSCRIBE_API_VERSION},
                    headers=self.auth_headers(provider.api_key),
                    files={
                        "audio": (audio.filename or "audio.wav", file_bytes, audio.mime_type or "audio/wav"),
                        "definition": (None, json.dumps(definition), "application/json"),
                    },
                )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            ) from exc

        if _no_language_identified(response):
            # Language identification found no speech (silence, music, a probe tone): the same outcome
            # other vendors report as an empty transcript, so the STT gateway's no-speech rule applies.
            return TranscribeResult(segments=[], detected_lang=None, audio_seconds=0.0)
        raise_for_http_status(response, provider, operation="transcription", capability="STT", log=_prov_log)
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderValidation(
                "Azure STT returned a non-JSON response",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            ) from exc
        return parse_fast_transcription(payload)


def _no_language_identified(response: httpx.Response) -> bool:
    """422 ``NoLanguageIdentified``: auto language detection heard no speech."""
    if response.status_code != 422:
        return False
    try:
        body = response.json()
    except ValueError:
        return False
    inner = body.get("innerError") if isinstance(body, dict) else None
    codes = {body.get("code") if isinstance(body, dict) else None, inner.get("code") if isinstance(inner, dict) else None}
    return "NoLanguageIdentified" in codes


# Locales written without spaces between words.
_NO_SPACE_LOCALES = ("zh", "ja", "th", "lo", "km", "my")


def _phrase_segments(phrase: dict, text: str, start: int, end: int, confidence: Optional[float]) -> list[SttSegment]:
    """One segment per phrase; a phrase longer than a cue is cut at its widest word gaps.

    With language identification Azure may return a whole paragraph as one unpunctuated
    phrase, which is unusable as a subtitle cue; its word timings locate the pauses.
    """
    words = [
        TimedWord(
            text=str(w.get("text") or ""),
            start_ms=int(w["offsetMilliseconds"]),
            end_ms=int(w["offsetMilliseconds"]) + max(1, int(w["durationMilliseconds"])),
        )
        for w in phrase.get("words") or []
        if isinstance(w, dict)
        and isinstance(w.get("offsetMilliseconds"), (int, float))
        and isinstance(w.get("durationMilliseconds"), (int, float))
        and str(w.get("text") or "").strip()
    ]
    if end - start <= MAX_SEGMENT_MS or len(words) < 2:
        return [SttSegment(text=text, start_ms=start, end_ms=end, confidence=confidence)]
    joiner = "" if str(phrase.get("locale") or "").lower().startswith(_NO_SPACE_LOCALES) else " "
    return [
        SttSegment(
            text=joiner.join(w.text.strip() for w in piece),
            start_ms=piece[0].start_ms,
            end_ms=piece[-1].end_ms,
            confidence=confidence,
        )
        for piece in split_at_widest_gaps(words)
    ]


def parse_fast_transcription(payload: object) -> TranscribeResult:
    """Fast Transcription JSON -> segments: each phrase is already one sentence."""
    if not isinstance(payload, dict) or not isinstance(payload.get("phrases", []), list):
        raise ProviderValidation(
            "Azure STT response has an unsupported shape",
            code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
            protocol="azure_speech",
            capability="STT",
        )
    segments: list[SttSegment] = []
    locales: Counter[str] = Counter()
    for phrase in payload.get("phrases") or []:
        if not isinstance(phrase, dict):
            continue
        text = str(phrase.get("text") or "").strip()
        offset = phrase.get("offsetMilliseconds")
        duration = phrase.get("durationMilliseconds")
        if not text or not isinstance(offset, (int, float)) or not isinstance(duration, (int, float)):
            continue
        start = int(offset)
        confidence = phrase.get("confidence")
        score = float(confidence) if isinstance(confidence, (int, float)) else None
        segments.extend(_phrase_segments(phrase, text, start, start + max(1, int(duration)), score))
        if phrase.get("locale"):
            locales[str(phrase["locale"])] += len(text)
    segments.sort(key=lambda seg: seg.start_ms)
    duration_ms = payload.get("durationMilliseconds")
    if isinstance(duration_ms, (int, float)):
        audio_seconds = float(duration_ms) / 1000.0
    else:
        audio_seconds = segments[-1].end_ms / 1000.0 if segments else 0.0
    detected = normalize_language(locales.most_common(1)[0][0]) if locales else None
    return TranscribeResult(segments=segments, detected_lang=detected, audio_seconds=audio_seconds)
