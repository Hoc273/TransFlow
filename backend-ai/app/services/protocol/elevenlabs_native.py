"""ElevenLabs native protocol adapter (TTS + AUTO voice discovery)."""
from __future__ import annotations

from urllib.parse import quote

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload, TtsVoice
from app.services.protocol.adapter import ProtocolAdapter
from app.services.protocol.http_utils import join_url, raise_for_http_status
from app.services.protocol.language_codes import normalize_language
from app.services.protocol.types import (
    Capability,
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
    supported_capabilities = frozenset({Capability.TTS.value})
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
        self.require_capability(Capability.TTS)
        payload = {"text": text, "model_id": provider.model}
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
        if capability != Capability.TTS.value:
            return ValidationPhaseResult(
                ok=False,
                message=f"Protocol {self.protocol} does not support {capability}",
            )
        return ValidationPhaseResult(
            ok=True,
            message="TTS capability declared; use tts-probe for live check",
        )
