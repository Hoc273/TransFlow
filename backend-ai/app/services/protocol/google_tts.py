"""Google Cloud TTS adapter — Workspace tier BYOK (Q-M-TTS-05 / Phase A1.2).

REST ``v1:text:synthesize`` authenticated with the ``X-Goog-Api-Key`` header.
The static voice catalog is the official GA vi-VN list (snapshot 2026-08-02);
the full voice matrix lives in Spring Boot system assets / preset metadata.
The phase-2 auth probe reuses the cheap ``v1/voices`` list endpoint.
"""
from __future__ import annotations

import base64

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload
from app.services.protocol.base_tts import BaseTtsAdapter
from app.services.protocol.http_utils import raise_for_http_status
from app.services.protocol.types import Capability, SynthesizeResult
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderTransport,
    ProviderValidation,
)

_prov_log = get_provider_logger("adapter.google_speech")


def _strip_version_prefix(base_url: str) -> str:
    return base_url.rstrip("/")[: -len("/v1")] if base_url.rstrip("/").endswith("/v1") else base_url.rstrip("/")


class GoogleSpeechAdapter(BaseTtsAdapter):
    protocol = "google_speech"
    supported_capabilities = frozenset({Capability.TTS.value})
    default_probe_voice = "vi-VN-Neural2-A"

    # ── Auth ─────────────────────────────────────────────────────────────────

    def auth_headers(self, api_key: str) -> dict[str, str]:
        return {"X-Goog-Api-Key": api_key}

    def auth_probe_path(self, base_url: str) -> str:
        return "/voices" if base_url.rstrip("/").endswith("/v1") else "/v1/voices"

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
