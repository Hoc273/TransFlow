"""CEP Phase A1.2 provider-specific tests — Google / Azure adapters.

Covers:
* Google: request shape (URL, X-Goog-Api-Key, JSON body), error mapping,
  empty-response handling.
* Azure: SSML body shape incl. XML escaping, Ocp-Apim header, error mapping.
* Static catalogs and registry registration.
* Gateway execution_info completion per segment (TC-CEP-09).
"""
from __future__ import annotations

import base64
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from app.schemas.contract import (
    CacheInfo,
    ExecutionInfo,
    ProviderPayload,
    TtsRequest,
    TtsResult,
    TtsSegment,
)
from app.services.protocol import registry as registry_module
from app.services.protocol.azure_tts import AzureSpeechAdapter
from app.services.protocol.google_tts import GoogleSpeechAdapter
from app.services.protocol.static_voices import (
    AZURE_TTS_VOICES,
    GOOGLE_TTS_VOICES,
)
from app.services.protocol.types import SynthesizeResult
from app.services.generated_asset_cache import NoopGeneratedAssetCache
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderException,
    ProviderValidation,
)
from app.services.tts_gateway import synthesize as gateway_synthesize
from app.services import tts_gateway as tts_gateway_module

# ── Shared helpers ───────────────────────────────────────────────────────────

def _provider(protocol: str) -> ProviderPayload:
    return ProviderPayload(
        protocol=protocol,  # type: ignore[arg-type]
        capabilities={"TTS"},
        base_url="http://provider.test/v1",
        api_key="sk-test",
        model="probe-model",
    )


class _FakeClient:
    """Minimal AsyncClient double recording calls (matches legacy tests)."""

    def __init__(self, response: httpx.Response) -> None:
        self.response = response
        self.calls: list[tuple[str, str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return self.response

    async def post(self, url: str, **kwargs):
        self.calls.append(("POST", url, kwargs))
        return self.response


# ── Google ───────────────────────────────────────────────────────────────────

class GoogleSpeechAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_synthesize_builds_correct_request(self):
        audio_b64 = base64.b64encode(b"audio-data").decode("ascii")
        client = _FakeClient(httpx.Response(200, json={"audioContent": audio_b64}))
        with patch(
            "app.services.protocol.google_tts.httpx.AsyncClient",
            return_value=client,
        ):
            adapter = GoogleSpeechAdapter()
            result = await adapter.synthesize(
                _provider("google_speech"), "Xin chào", "vi-VN-Neural2-A"
            )

        self.assertEqual(b"audio-data", result.audio_bytes)
        self.assertEqual("audio/mpeg", result.mime_type)
        method, url, kwargs = client.calls[0]
        self.assertEqual("POST", method)
        self.assertEqual("http://provider.test/v1/text:synthesize", url)
        self.assertEqual("sk-test", kwargs["headers"]["X-Goog-Api-Key"])
        body = kwargs["json"]
        self.assertEqual({"text": "Xin chào"}, body["input"])
        self.assertEqual(
            {"languageCode": "vi-VN", "name": "vi-VN-Neural2-A"},
            body["voice"],
        )
        self.assertEqual("MP3", body["audioConfig"]["audioEncoding"])

    async def test_synthesize_handles_base_url_without_version(self):
        client = _FakeClient(
            httpx.Response(200, json={"audioContent": base64.b64encode(b"x").decode()})
        )
        provider = _provider("google_speech")
        provider.base_url = "http://google.test"
        with patch(
            "app.services.protocol.google_tts.httpx.AsyncClient",
            return_value=client,
        ):
            await GoogleSpeechAdapter().synthesize(provider, "hi", "vi-VN-Neural2-A")
        _, url, _ = client.calls[0]
        self.assertEqual("http://google.test/v1/text:synthesize", url)

    async def test_error_mapping(self):
        for status, expected in (
            (401, ProviderErrorCode.PROVIDER_AUTH_FAILED),
            (429, ProviderErrorCode.PROVIDER_RATE_LIMITED),
            (502, ProviderErrorCode.PROVIDER_INTERNAL_ERROR),
        ):
            with self.subTest(status=status):
                client = _FakeClient(httpx.Response(status, text="nope"))
                with patch(
                    "app.services.protocol.google_tts.httpx.AsyncClient",
                    return_value=client,
                ):
                    with self.assertRaises(ProviderException) as ctx:
                        await GoogleSpeechAdapter().synthesize(
                            _provider("google_speech"), "hi", "vi-VN-Neural2-A"
                        )
                self.assertEqual(expected, ctx.exception.code)

    async def test_empty_response(self):
        client = _FakeClient(httpx.Response(200, json={}))
        with patch(
            "app.services.protocol.google_tts.httpx.AsyncClient",
            return_value=client,
        ):
            with self.assertRaises(ProviderValidation) as ctx:
                await GoogleSpeechAdapter().synthesize(
                    _provider("google_speech"), "hi", "vi-VN-Neural2-A"
                )
        self.assertEqual(ProviderErrorCode.PROVIDER_EMPTY_RESPONSE, ctx.exception.code)


# ── Azure ────────────────────────────────────────────────────────────────────

class AzureSpeechAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_synthesize_builds_ssml_with_escaping(self):
        client = _FakeClient(httpx.Response(200, content=b"mp3data"))
        with patch(
            "app.services.protocol.azure_tts.httpx.AsyncClient",
            return_value=client,
        ):
            result = await AzureSpeechAdapter().synthesize(
                _provider("azure_speech"), "a < b & c", "vi-VN-HoaiMyNeural"
            )

        self.assertEqual(b"mp3data", result.audio_bytes)
        method, url, kwargs = client.calls[0]
        self.assertEqual("POST", method)
        self.assertEqual("http://provider.test/v1/cognitiveservices/v1", url)
        headers = kwargs["headers"]
        self.assertEqual("sk-test", headers["Ocp-Apim-Subscription-Key"])
        self.assertEqual("application/ssml+xml", headers["Content-Type"])
        self.assertEqual(
            "audio-24khz-48kbitrate-mono-mp3",
            headers["X-Microsoft-OutputFormat"],
        )
        ssml = kwargs["content"]
        self.assertIn("xml:lang='vi-VN'", ssml)
        self.assertIn("<voice name='vi-VN-HoaiMyNeural'>a &lt; b &amp; c</voice>", ssml)

    async def test_error_mapping(self):
        client = _FakeClient(httpx.Response(401, text="denied"))
        with patch(
            "app.services.protocol.azure_tts.httpx.AsyncClient",
            return_value=client,
        ):
            with self.assertRaises(ProviderException) as ctx:
                await AzureSpeechAdapter().synthesize(
                    _provider("azure_speech"), "hi", "vi-VN-HoaiMyNeural"
                )
        self.assertEqual(ProviderErrorCode.PROVIDER_AUTH_FAILED, ctx.exception.code)

    async def test_empty_response(self):
        client = _FakeClient(httpx.Response(200, content=b""))
        with patch(
            "app.services.protocol.azure_tts.httpx.AsyncClient",
            return_value=client,
        ):
            with self.assertRaises(ProviderValidation) as ctx:
                await AzureSpeechAdapter().synthesize(
                    _provider("azure_speech"), "hi", "vi-VN-HoaiMyNeural"
                )
        self.assertEqual(ProviderErrorCode.PROVIDER_EMPTY_RESPONSE, ctx.exception.code)


class AzureSpeechEndpointAndDiscoveryTest(unittest.IsolatedAsyncioTestCase):
    """The Azure Portal shows ``{region}.api.cognitive.microsoft.com`` as the key's
    endpoint, but TTS REST (synthesis + voices/list) only lives on
    ``{region}.tts.speech.microsoft.com`` — the portal host answers 404."""

    def _azure(self, base_url: str) -> ProviderPayload:
        return ProviderPayload(
            protocol="azure_speech",  # type: ignore[arg-type]
            capabilities={"TTS"},
            base_url=base_url,
            api_key="sk-test",
            model="en-US-JennyNeural",
        )

    def test_portal_endpoint_maps_to_speech_host(self):
        from app.services.protocol.azure_tts import speech_base_url

        self.assertEqual(
            "https://southeastasia.tts.speech.microsoft.com",
            speech_base_url("https://southeastasia.api.cognitive.microsoft.com/"),
        )
        self.assertEqual(
            "https://eastus.tts.speech.microsoft.com",
            speech_base_url("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"),
        )
        self.assertEqual("http://provider.test/v1", speech_base_url("http://provider.test/v1/"))

    def test_auth_probe_url_uses_speech_host(self):
        self.assertEqual(
            "https://southeastasia.tts.speech.microsoft.com/cognitiveservices/voices/list",
            AzureSpeechAdapter().auth_probe_url("https://southeastasia.api.cognitive.microsoft.com/"),
        )

    async def test_synthesize_any_locale_voice_on_speech_host(self):
        client = _FakeClient(httpx.Response(200, content=b"mp3data"))
        with patch("app.services.protocol.azure_tts.httpx.AsyncClient", return_value=client):
            await AzureSpeechAdapter().synthesize(
                self._azure("https://southeastasia.api.cognitive.microsoft.com/"),
                "Hello", "en-US-JennyNeural",
            )
        _, url, kwargs = client.calls[0]
        self.assertEqual("https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1", url)
        self.assertIn("xml:lang='en-US'", kwargs["content"])

    async def test_hd_and_mai_voice_ids_pass_gate(self):
        # ~12% of the live catalog uses ``Name:Model`` ids (Dragon HD, MAI-Voice-2).
        cases = {
            "en-US-Ava:DragonHDLatestNeural": "en-US",
            "de-DE-Klaus:MAI-Voice-2-Flash": "de-DE",
            "en-Multitalker:DragonHDLatestNeural": "en",
            "zh-CN-shaanxi-XiaoniNeural": "zh-CN",
            "yue-CN-XiaoMinNeural": "yue-CN",
            "en-us-ava:DragonHDOmniLatestNeural": "en-US",
            "hu-HU-Réka:MAI-Voice-2": "hu-HU",
        }
        for voice_id, lang in cases.items():
            client = _FakeClient(httpx.Response(200, content=b"mp3data"))
            with patch("app.services.protocol.azure_tts.httpx.AsyncClient", return_value=client):
                await AzureSpeechAdapter().synthesize(
                    self._azure("https://southeastasia.tts.speech.microsoft.com"), "hi", voice_id
                )
            self.assertIn(f"xml:lang='{lang}'", client.calls[0][2]["content"], voice_id)

    async def test_malformed_voice_rejected_before_call(self):
        client = _FakeClient(httpx.Response(200, content=b"mp3data"))
        with patch("app.services.protocol.azure_tts.httpx.AsyncClient", return_value=client):
            with self.assertRaises(ProviderValidation) as ctx:
                await AzureSpeechAdapter().synthesize(
                    self._azure("https://southeastasia.api.cognitive.microsoft.com/"), "hi", "alloy"
                )
        self.assertEqual(ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND, ctx.exception.code)
        self.assertEqual([], client.calls)

    async def test_discover_voices_lists_live_catalog(self):
        payload = [
            {"ShortName": "en-US-JennyNeural", "LocalName": "Jenny", "DisplayName": "Jenny",
             "Gender": "Female", "Locale": "en-US"},
            {"ShortName": "de-DE-SeraphinaMultilingualNeural", "LocalName": "Seraphina Mehrsprachig",
             "DisplayName": "Seraphina Multilingual", "Gender": "Female", "Locale": "de-DE",
             "SecondaryLocaleList": ["en-US", "vi-VN", "zh-CN"]},
            {"ShortName": "vi-VN-NamMinhNeural", "LocalName": "Nam Minh", "Gender": "Male",
             "Locale": "vi-VN", "Status": "Preview"},
            {"ShortName": "zh-CN-XiaoxiaoNeural", "LocalName": "晓晓", "DisplayName": "Xiaoxiao",
             "Gender": "Female", "Locale": "zh-CN", "Status": "Deprecated"},
            {"ShortName": "", "Locale": "en-US"},
        ]
        client = _FakeClient(httpx.Response(200, json=payload))
        with patch("app.services.protocol.azure_tts.httpx.AsyncClient", return_value=client):
            result = await AzureSpeechAdapter().discover_voices(
                self._azure("https://southeastasia.api.cognitive.microsoft.com")
            )

        method, url, kwargs = client.calls[0]
        self.assertEqual("GET", method)
        self.assertEqual("https://southeastasia.tts.speech.microsoft.com/cognitiveservices/voices/list", url)
        self.assertEqual("sk-test", kwargs["headers"]["Ocp-Apim-Subscription-Key"])
        self.assertEqual("AUTHORITATIVE", result.mode)
        by_id = {v.voice_id: v for v in result.voices}
        self.assertEqual(4, len(by_id))
        self.assertEqual("en-US", by_id["en-US-JennyNeural"].language)
        self.assertEqual("Jenny", by_id["en-US-JennyNeural"].display_name)
        self.assertEqual("GA", by_id["en-US-JennyNeural"].status)
        self.assertEqual("Nam Minh", by_id["vi-VN-NamMinhNeural"].display_name)
        self.assertEqual("PREVIEW", by_id["vi-VN-NamMinhNeural"].status)
        # Non-Latin LocalName falls back to the romanized DisplayName.
        self.assertEqual("Xiaoxiao", by_id["zh-CN-XiaoxiaoNeural"].display_name)
        self.assertEqual("DEPRECATED", by_id["zh-CN-XiaoxiaoNeural"].status)
        self.assertEqual("FEMALE", by_id["en-US-JennyNeural"].gender)
        self.assertEqual(["de", "en", "vi", "zh"], by_id["de-DE-SeraphinaMultilingualNeural"].languages)
        self.assertEqual("MALE", by_id["vi-VN-NamMinhNeural"].gender)

    async def test_discover_voices_auth_error(self):
        client = _FakeClient(httpx.Response(401, text="denied"))
        with patch("app.services.protocol.azure_tts.httpx.AsyncClient", return_value=client):
            with self.assertRaises(ProviderException) as ctx:
                await AzureSpeechAdapter().discover_voices(
                    self._azure("https://southeastasia.api.cognitive.microsoft.com")
                )
        self.assertEqual(ProviderErrorCode.PROVIDER_AUTH_FAILED, ctx.exception.code)


class GoogleSpeechDiscoveryTest(unittest.IsolatedAsyncioTestCase):
    """Google voices are listed live from ``v1/voices``; synthesis takes the
    ``languageCode`` from the voice name (a hard-coded vi-VN broke every other
    language)."""

    async def test_synthesize_uses_locale_of_voice_name(self):
        cases = {
            "en-US-Neural2-A": "en-US",
            "cmn-CN-Wavenet-B": "cmn-CN",
            "en-US-Chirp3-HD-Achernar": "en-US",
            "es-419-Standard-A": "es-419",
        }
        for voice_id, lang in cases.items():
            client = _FakeClient(
                httpx.Response(200, json={"audioContent": base64.b64encode(b"x").decode()})
            )
            with patch("app.services.protocol.google_tts.httpx.AsyncClient", return_value=client):
                await GoogleSpeechAdapter().synthesize(_provider("google_speech"), "hi", voice_id)
            self.assertEqual(
                {"languageCode": lang, "name": voice_id}, client.calls[0][2]["json"]["voice"], voice_id
            )

    async def test_foreign_protocol_voice_rejected_before_call(self):
        client = _FakeClient(httpx.Response(200, json={}))
        with patch("app.services.protocol.google_tts.httpx.AsyncClient", return_value=client):
            with self.assertRaises(ProviderValidation) as ctx:
                await GoogleSpeechAdapter().synthesize(_provider("google_speech"), "hi", "alloy")
        self.assertEqual(ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND, ctx.exception.code)
        self.assertEqual([], client.calls)

    async def test_discover_voices_lists_live_catalog(self):
        payload = {"voices": [
            {"languageCodes": ["vi-VN"], "name": "vi-VN-Neural2-A", "ssmlGender": "FEMALE"},
            {"languageCodes": ["en-US"], "name": "en-US-Chirp3-HD-Achernar", "ssmlGender": "FEMALE"},
            {"languageCodes": ["cmn-CN"], "name": "cmn-CN-Wavenet-B", "ssmlGender": "MALE"},
            {"languageCodes": [], "name": "", "ssmlGender": "NEUTRAL"},
        ]}
        client = _FakeClient(httpx.Response(200, json=payload))
        provider = _provider("google_speech")
        provider.base_url = "https://texttospeech.googleapis.com"
        with patch("app.services.protocol.google_tts.httpx.AsyncClient", return_value=client):
            result = await GoogleSpeechAdapter().discover_voices(provider)

        method, url, kwargs = client.calls[0]
        self.assertEqual(("GET", "https://texttospeech.googleapis.com/v1/voices"), (method, url))
        self.assertEqual("sk-test", kwargs["headers"]["X-Goog-Api-Key"])
        self.assertEqual("AUTHORITATIVE", result.mode)
        by_id = {v.voice_id: v for v in result.voices}
        self.assertEqual({"vi-VN-Neural2-A", "en-US-Chirp3-HD-Achernar", "cmn-CN-Wavenet-B"}, set(by_id))
        self.assertEqual("Chirp3-HD-Achernar", by_id["en-US-Chirp3-HD-Achernar"].display_name)
        # Mandarin is tagged ``cmn`` by Google; Chinese targets in the app are ``zh``.
        self.assertEqual(["cmn", "zh"], by_id["cmn-CN-Wavenet-B"].languages)
        self.assertEqual("MALE", by_id["cmn-CN-Wavenet-B"].gender)

    async def test_discover_voices_maps_bad_key(self):
        client = _FakeClient(httpx.Response(403, json={"error": {"message": "API key not valid"}}))
        with patch("app.services.protocol.google_tts.httpx.AsyncClient", return_value=client):
            with self.assertRaises(ProviderException):
                await GoogleSpeechAdapter().discover_voices(_provider("google_speech"))


# ── Catalogs & registry ──────────────────────────────────────────────────────

class CatalogRegistryTest(unittest.TestCase):
    def test_google_catalog_snapshot(self):
        ids = [voice.voice_id for voice in GOOGLE_TTS_VOICES]
        self.assertEqual(10, len(ids))
        # Two newest (Neural2) first per Q-M-TTS-05 ordering.
        self.assertEqual("vi-VN-Neural2-A", ids[0])
        self.assertEqual("vi-VN-Neural2-D", ids[1])
        self.assertTrue(all(voice_id.startswith("vi-VN-") for voice_id in ids))
        genders = {voice.gender for voice in GOOGLE_TTS_VOICES}
        self.assertEqual({"MALE", "FEMALE"}, genders)

    def test_azure_catalog(self):
        ids = {voice.voice_id for voice in AZURE_TTS_VOICES}
        self.assertEqual({"vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"}, ids)

    def test_registry_registers_tts_adapters_without_local_engine(self):
        protocols = set(registry_module.get_registry().protocols())
        self.assertTrue({"google_speech", "azure_speech"} <= protocols)
        self.assertNotIn("local_piper", protocols)
        adapter = registry_module.require_adapter("google_speech", capability="TTS")
        self.assertIsInstance(adapter, GoogleSpeechAdapter)


# ── Gateway execution_info ───────────────────────────────────────────────────

class GatewayExecutionInfoTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        patcher = patch("app.services.tts_gateway.get_cache", return_value=NoopGeneratedAssetCache())
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_gateway_completes_execution_info_per_segment(self):
        request = TtsRequest(
            correlation_id="corr-1",
            media_job_id="job-1",
            voice_id="vi-VN-Neural2-A",
            segments=[
                TtsSegment(segment_id="s1", target_text="Xin chào"),
                TtsSegment(segment_id="s2", target_text="Hello"),
            ],
            provider=_provider("google_speech"),
        )

        async def fake_synthesize(provider, text, voice_id):
            return SynthesizeResult(
                audio_bytes=b"audio",
                mime_type="audio/mpeg",
                metadata={
                    "execution_info": {
                        "provider": "google_speech",
                        "model": "probe-model",
                        "voice": "vi-VN-Neural2-A",
                    }
                },
            )

        fake_adapter = SimpleNamespace(
            synthesize=fake_synthesize,
            protocol="google_speech",
            requires_api_key=True,
        )
        # Real settings: mock_mode=False, "sk-test" is a usable key — the gateway
        # runs the adapter path naturally (no settings patching needed).
        with patch("app.services.tts_gateway.require_adapter", return_value=fake_adapter):
            response = await gateway_synthesize(request)

        self.assertEqual("COMPLETED", response.status)
        self.assertEqual(2, len(response.results))
        for result in response.results:
            self.assertEqual("SUCCESS", result.status)
            info = result.execution_info
            self.assertIsNotNone(info)
            self.assertEqual("google_speech", info.provider)
            self.assertEqual("probe-model", info.model)
            self.assertEqual("vi-VN-Neural2-A", info.voice)
            self.assertIsNotNone(info.request_id)
            self.assertIsNotNone(info.latency_ms)
            self.assertIsNotNone(info.cache)
            self.assertFalse(info.cache.hit)
            self.assertIsNone(info.cache.source)
        # Distinct request ids per segment.
        self.assertNotEqual(
            response.results[0].execution_info.request_id,
            response.results[1].execution_info.request_id,
        )

    def test_execution_info_serializes_without_key(self):
        info = ExecutionInfo(
            provider="google_speech",
            model="probe-model",
            voice="vi-VN-Neural2-A",
            cache=CacheInfo(hit=False, source=None),
            latency_ms=12,
            request_id="abc123",
        )
        payload = json.loads(info.model_dump_json(by_alias=True))
        # Wire shape is camelCase (ADR-CEP §9): latency_ms → latencyMs,
        # request_id → requestId.
        self.assertEqual("google_speech", payload["provider"])
        self.assertFalse(payload["cache"]["hit"])
        self.assertEqual(12, payload["latencyMs"])
        self.assertEqual("abc123", payload["requestId"])
        self.assertNotIn("latency_ms", payload)
        self.assertNotIn("request_id", payload)
        self.assertNotIn("api_key", payload)


# ── Gateway API-key gate (P0-1) ──────────────────────────────────────────────

class GatewayKeyGateTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        patcher = patch("app.services.tts_gateway.get_cache", return_value=NoopGeneratedAssetCache())
        patcher.start()
        self.addCleanup(patcher.stop)

    def _adapter(self, requires_key: bool) -> SimpleNamespace:
        return SimpleNamespace(requires_api_key=requires_key)

    def test_key_requiring_adapter_mocked_without_key(self):
        # google_speech / azure_speech with empty api_key → mock (FALLBACK).
        self.assertTrue(
            tts_gateway_module._should_mock(
                _provider("google_speech").model_copy(update={"api_key": ""}),
                self._adapter(requires_key=True),
            )
        )

# ── OI-01 (D2.6) — typed per-segment errorCode (T1..T6) ─────────────────────

class GatewayPerSegmentErrorCodeTest(unittest.IsolatedAsyncioTestCase):
    """OI-01 (`93` §4.19.12): per-segment errorCode wire contract."""

    async def asyncSetUp(self):
        patcher = patch("app.services.tts_gateway.get_cache", return_value=NoopGeneratedAssetCache())
        patcher.start()
        self.addCleanup(patcher.stop)

    def _request(self, *segment_ids: str) -> TtsRequest:
        return TtsRequest(
            correlation_id="corr-oi01",
            media_job_id="job-oi01",
            voice_id="vi-VN-Neural2-A",
            segments=[TtsSegment(segment_id=sid, target_text=f"text-{sid}") for sid in segment_ids],
            provider=_provider("google_speech"),
        )

    def _adapter(self, synthesize) -> SimpleNamespace:
        return SimpleNamespace(
            synthesize=synthesize,
            protocol="google_speech",
            requires_api_key=True,
        )

    async def test_typed_provider_exception_carries_error_code(self):  # T1
        async def fake_synthesize(provider, text, voice_id):
            raise ProviderValidation(
                "voice not found", code=ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND
            )

        request = self._request("s1")
        with patch("app.services.tts_gateway.require_adapter", return_value=self._adapter(fake_synthesize)):
            response = await gateway_synthesize(request)
        self.assertEqual("FAILED", response.results[0].status)
        self.assertEqual("PROVIDER_TTS_VOICE_NOT_FOUND", response.results[0].errorCode)
        self.assertIsNotNone(response.results[0].error)

    async def test_quota_mid_batch_stops_calling_and_reports_cause(self):
        calls: list[str] = []

        async def fake_synthesize(provider, text, voice_id):
            calls.append(text)
            if len(calls) == 1:
                return SynthesizeResult(audio_bytes=b"audio", mime_type="audio/mpeg")
            raise ProviderValidation("quota", code=ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED)

        request = self._request("s1", "s2", "s3")
        with patch("app.services.tts_gateway.require_adapter", return_value=self._adapter(fake_synthesize)):
            response = await gateway_synthesize(request)
        self.assertEqual(2, len(calls))  # s3 is not sent once the key is out of quota
        self.assertEqual("COMPLETED", response.status)
        self.assertEqual(["SUCCESS", "FAILED", "FAILED"], [r.status for r in response.results])
        self.assertEqual("PROVIDER_QUOTA_EXCEEDED", response.results[2].errorCode)
        # Partial success still carries the cause so Spring can fail over / defer.
        self.assertEqual("PROVIDER_QUOTA_EXCEEDED", response.error_detail.errorCode)

    async def test_isolated_rate_limit_from_a_pool_does_not_stop_the_batch(self):
        # FreeLLMAPI answers 429 when one pass over its chain failed; the next call may succeed.
        outcomes = iter(["429", "ok", "429", "429", "ok"])
        calls: list[str] = []

        async def fake_synthesize(provider, text, voice_id):
            calls.append(text)
            if next(outcomes) == "429":
                raise ProviderValidation("limited", code=ProviderErrorCode.PROVIDER_RATE_LIMITED)
            return SynthesizeResult(audio_bytes=b"audio", mime_type="audio/mpeg")

        request = self._request("s1", "s2", "s3", "s4", "s5")
        with patch("app.services.tts_gateway.require_adapter", return_value=self._adapter(fake_synthesize)):
            response = await gateway_synthesize(request)
        self.assertEqual(5, len(calls))
        self.assertEqual(["FAILED", "SUCCESS", "FAILED", "FAILED", "SUCCESS"], [r.status for r in response.results])

    async def test_rate_limit_streak_stops_calling(self):
        calls: list[str] = []

        async def fake_synthesize(provider, text, voice_id):
            calls.append(text)
            raise ProviderValidation("limited", code=ProviderErrorCode.PROVIDER_RATE_LIMITED)

        request = self._request("s1", "s2", "s3", "s4", "s5")
        with patch("app.services.tts_gateway.require_adapter", return_value=self._adapter(fake_synthesize)):
            response = await gateway_synthesize(request)
        self.assertEqual(3, len(calls))  # s4/s5 are not sent once the key is clearly throttled
        self.assertEqual("PROVIDER_RATE_LIMITED", response.results[4].errorCode)

    async def test_segment_level_failure_does_not_stop_the_batch(self):
        calls: list[str] = []

        async def fake_synthesize(provider, text, voice_id):
            calls.append(text)
            if len(calls) == 1:
                raise ProviderValidation("filtered", code=ProviderErrorCode.PROVIDER_CONTENT_FILTERED)
            return SynthesizeResult(audio_bytes=b"audio", mime_type="audio/mpeg")

        request = self._request("s1", "s2")
        with patch("app.services.tts_gateway.require_adapter", return_value=self._adapter(fake_synthesize)):
            response = await gateway_synthesize(request)
        self.assertEqual(2, len(calls))
        self.assertEqual(["FAILED", "SUCCESS"], [r.status for r in response.results])

    async def test_generic_exception_carries_provider_unknown(self):  # T2
        async def fake_synthesize(provider, text, voice_id):
            raise RuntimeError("boom")

        request = self._request("s1")
        with patch("app.services.tts_gateway.require_adapter", return_value=self._adapter(fake_synthesize)):
            response = await gateway_synthesize(request)
        self.assertEqual("FAILED", response.results[0].status)
        self.assertEqual("PROVIDER_UNKNOWN", response.results[0].errorCode)
        self.assertIsNotNone(response.results[0].error)
        self.assertEqual("PROVIDER_UNKNOWN", response.error_detail.errorCode)
        self.assertEqual("probe-model", response.error_detail.model)

    async def test_success_segments_omit_error_code(self):  # T3
        async def fake_synthesize(provider, text, voice_id):
            return SynthesizeResult(
                audio_bytes=b"audio",
                mime_type="audio/mpeg",
                metadata={"execution_info": {"provider": "google_speech"}},
            )

        request = self._request("s1", "s2")
        with patch("app.services.tts_gateway.require_adapter", return_value=self._adapter(fake_synthesize)):
            response = await gateway_synthesize(request)
        self.assertEqual("COMPLETED", response.status)
        for result in response.results:
            self.assertEqual("SUCCESS", result.status)
            self.assertIsNone(result.errorCode)

    async def test_mixed_success_and_failed_keep_per_segment_codes(self):  # T4
        async def fake_synthesize(provider, text, voice_id):
            if text == "text-s2":
                raise ProviderValidation(
                    "voice not found", code=ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND
                )
            return SynthesizeResult(
                audio_bytes=b"audio",
                mime_type="audio/mpeg",
                metadata={"execution_info": {"provider": "google_speech"}},
            )

        request = self._request("s1", "s2")
        with patch("app.services.tts_gateway.require_adapter", return_value=self._adapter(fake_synthesize)):
            response = await gateway_synthesize(request)
        self.assertEqual("COMPLETED", response.status)
        self.assertEqual("SUCCESS", response.results[0].status)
        self.assertIsNone(response.results[0].errorCode)
        self.assertEqual("FAILED", response.results[1].status)
        self.assertEqual("PROVIDER_TTS_VOICE_NOT_FOUND", response.results[1].errorCode)

    async def test_mock_response_omits_error_code(self):  # T5 (backward compat)
        fake_adapter = SimpleNamespace(
            synthesize=None, protocol="google_speech", requires_api_key=True
        )
        with patch("app.core.config.settings.mock_mode", True), \
                patch("app.services.tts_gateway.require_adapter", return_value=fake_adapter):
            response = await gateway_synthesize(self._request("s1"))
        self.assertEqual("COMPLETED", response.status)
        self.assertEqual("SUCCESS", response.results[0].status)
        self.assertIsNone(response.results[0].errorCode)

    def test_wire_shape_is_camel_case_error_code(self):  # T6
        result = TtsResult(
            segment_id="s1", status="FAILED", error="boom",
            errorCode="PROVIDER_UNKNOWN",
        )
        payload = json.loads(result.model_dump_json(by_alias=True))
        self.assertEqual("PROVIDER_UNKNOWN", payload["errorCode"])
        self.assertNotIn("error_code", payload)


if __name__ == "__main__":
    unittest.main()

class ProtocolKeyGateContractTest(unittest.TestCase):
    """Phase D P2-3: every registered adapter must declare requires_api_key so the
    gateway key gates (tts_gateway._should_mock, validate_gateway probe) never
    AttributeError for cloud adapters extending ProtocolAdapter directly."""

    def test_all_registered_adapters_declare_requires_api_key(self):
        from app.services.protocol.registry import get_registry
        for adapter in get_registry().adapters():
            self.assertTrue(
                hasattr(adapter, "requires_api_key"),
                f"adapter {type(adapter).__name__} ({adapter.protocol}) has no requires_api_key",
            )

    def test_every_registered_adapter_requires_api_key(self):
        from app.services.protocol.registry import get_registry
        by_protocol = {a.protocol: a for a in get_registry().adapters()}
        self.assertTrue(all(a.requires_api_key for a in by_protocol.values()))
        self.assertTrue(by_protocol["openai_compatible"].requires_api_key)
        self.assertTrue(by_protocol["dashscope_native"].requires_api_key)
        self.assertTrue(by_protocol["elevenlabs_native"].requires_api_key)
        self.assertTrue(by_protocol["google_speech"].requires_api_key)
        self.assertTrue(by_protocol["azure_speech"].requires_api_key)
