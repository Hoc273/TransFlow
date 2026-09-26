"""Google Cloud TTS adapter — Workspace tier BYOK (Q-M-TTS-05 / Phase A1.2).

REST ``v1:text:synthesize`` authenticated with the ``X-Goog-Api-Key`` header.
Voices are discovered live from ``v1/voices`` (every language the key can use;
also the phase-2 auth probe). The static vi-VN snapshot stays as the offline
catalog. ``languageCode`` is taken from the voice name (``en-US-Neural2-A`` →
``en-US``): Google rejects a synthesis whose languageCode does not match the voice.
"""
from __future__ import annotations

import base64
import re

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload, TtsVoice
from app.services.protocol.base_tts import BaseTtsAdapter
from app.services.protocol.http_utils import raise_for_http_status
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

_prov_log = get_provider_logger("adapter.google_speech")

# Google voice names: ``{lang}-{REGION}-{Family}-{Variant}`` — ``vi-VN-Neural2-A``,
# ``cmn-CN-Wavenet-B``, ``en-US-Chirp3-HD-Achernar``, ``es-419-Standard-A``.
# Google tags Chinese voices by spoken language (Mandarin ``cmn``, Cantonese ``yue``);
# the app's target language for Chinese is ``zh`` (as in Azure's zh-CN / zh-HK).
_CHINESE_SPOKEN = {"cmn", "yue"}
_VOICE_ID_RE = re.compile(r"^(?P<locale>[a-z]{2,3}-(?:[A-Z]{2}|[0-9]{3}))-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$")


def _strip_version_prefix(base_url: str) -> str:
    return base_url.rstrip("/")[: -len("/v1")] if base_url.rstrip("/").endswith("/v1") else base_url.rstrip("/")


class GoogleSpeechAdapter(BaseTtsAdapter):
    protocol = "google_speech"
    supported_capabilities = frozenset({Capability.TTS.value})
    default_probe_voice = "vi-VN-Neural2-A"
    voice_discovery_strategy = VoiceDiscoveryStrategy.AUTO

    # ── Auth ─────────────────────────────────────────────────────────────────

    def auth_headers(self, api_key: str) -> dict[str, str]:
        return {"X-Goog-Api-Key": api_key}

    def auth_probe_path(self, base_url: str) -> str:
        return "/voices" if base_url.rstrip("/").endswith("/v1") else "/v1/voices"

    # ── Voices ───────────────────────────────────────────────────────────────

    def ensure_voice_known(self, voice_id: str) -> None:
        """The live ``v1/voices`` list is the authority; only reject names that
        cannot be a Google voice (``alloy``, ``Serena``)."""
        if _VOICE_ID_RE.match(voice_id or ""):
            return
        super().ensure_voice_known(voice_id)

    async def discover_voices(self, provider: ProviderPayload) -> VoiceDiscoveryResult:
        url = f"{_strip_version_prefix(provider.base_url)}/v1/voices"
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
        for item in (response.json() or {}).get("voices") or []:
            voice_id = (item.get("name") or "").strip()
            codes = [c for c in (item.get("languageCodes") or []) if c]
            match = _VOICE_ID_RE.match(voice_id)
            if not voice_id or not (codes or match):
                continue
            gender = (item.get("ssmlGender") or "").upper()
            locale = codes[0] if codes else match.group("locale")
            languages = normalize_languages(codes or [locale])
            if _CHINESE_SPOKEN & set(languages):
                languages.append("zh")
            voices.append(
                TtsVoice(
                    voice_id=voice_id,
                    language=locale,
                    languages=languages or None,
                    gender=gender if gender in ("MALE", "FEMALE") else None,
                    display_name=voice_id[len(match.group("locale")) + 1:] if match else voice_id,
                )
            )
        return VoiceDiscoveryResult(
            strategy=self.voice_discovery_strategy,
            mode="AUTHORITATIVE",
            voices=voices,
            detail=f"{len(voices)} voices from Google v1/voices",
        )

    # ── TTS ──────────────────────────────────────────────────────────────────

    async def _synthesize_engine(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        match = _VOICE_ID_RE.match(voice_id)
        language = match.group("locale") if match else next(
            (v.language for v in self.catalog() if v.voice_id == voice_id),
            "vi-VN",
        )
        payload = {
            "input": {"text": text},
            "voice": {"languageCode": language, "name": voice_id},
            "audioConfig": {"audioEncoding": "MP3"},
        }
        url = f"{_strip_version_prefix(provider.base_url)}/v1/text:synthesize"
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                response = await client.post(
                    url,
                    headers=self.auth_headers(provider.api_key),
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

        try:
            body = response.json()
            audio_b64 = body.get("audioContent") if isinstance(body, dict) else None
        except Exception:
            audio_b64 = None
        if not audio_b64:
            raise ProviderValidation(
                "Google TTS returned no audioContent",
                code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            )
        return SynthesizeResult(
            audio_bytes=base64.b64decode(audio_b64),
            mime_type="audio/mpeg",
            metadata={"format": "mp3"},
        )
