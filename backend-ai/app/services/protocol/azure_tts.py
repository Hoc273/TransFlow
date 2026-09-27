"""Azure Speech adapter — Workspace tier BYOK (Q-M-TTS-05 / Phase A1.2).

REST ``cognitiveservices/v1`` with an ``Ocp-Apim-Subscription-Key`` header and
an SSML body; audio comes back as raw MP3 bytes. Voices are discovered live from
``cognitiveservices/voices/list`` (also the phase-2 auth probe: 200 with a valid
key, 401 without).

The Azure Portal shows ``https://{region}.api.cognitive.microsoft.com/`` as the
resource endpoint, but that host answers 404 for every TTS REST call — synthesis
and voice listing only live on ``https://{region}.tts.speech.microsoft.com``.
``speech_base_url`` maps the portal endpoint so users can paste it as-is.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit
from xml.sax.saxutils import escape as xml_escape

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload, TtsVoice
from app.services.protocol.base_tts import BaseTtsAdapter
from app.services.protocol.http_utils import join_url, raise_for_http_status
from app.services.protocol.language_codes import normalize_languages
from app.services.protocol.types import (
    Capability,
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
    supported_capabilities = frozenset({Capability.TTS.value})
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
