"""Azure Speech adapter — Workspace tier BYOK (Q-M-TTS-05 / Phase A1.2).

REST ``cognitiveservices/v1`` with an ``Ocp-Apim-Subscription-Key`` header and
an SSML body; audio comes back as raw MP3 bytes. The phase-2 auth probe uses
``cognitiveservices/voices/list`` (200 with a valid key, 401 without).
"""
from __future__ import annotations

from xml.sax.saxutils import escape as xml_escape

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload
from app.services.protocol.base_tts import BaseTtsAdapter
from app.services.protocol.http_utils import join_url, raise_for_http_status
from app.services.protocol.types import Capability, SynthesizeResult
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderTransport,
    ProviderValidation,
)

_prov_log = get_provider_logger("adapter.azure_speech")


class AzureSpeechAdapter(BaseTtsAdapter):
    protocol = "azure_speech"
    supported_capabilities = frozenset({Capability.TTS.value})
    default_probe_voice = "vi-VN-HoaiMyNeural"

    # ── Auth ─────────────────────────────────────────────────────────────────

    def auth_headers(self, api_key: str) -> dict[str, str]:
        return {"Ocp-Apim-Subscription-Key": api_key}

    def auth_probe_path(self, base_url: str) -> str:
        return "/cognitiveservices/voices/list"

    # ── TTS ──────────────────────────────────────────────────────────────────

    async def _synthesize_engine(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        language = next(
            (v.language for v in self.catalog() if v.voice_id == voice_id),
            "vi-VN",
        )
        ssml = (
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' "
            f"xml:lang='{language}'>"
            f"<voice name='{xml_escape(voice_id)}'>{xml_escape(text)}</voice></speak>"
        )
        headers = {
            **self.auth_headers(provider.api_key),
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        }
        url = join_url(provider.base_url, "/cognitiveservices/v1")
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
