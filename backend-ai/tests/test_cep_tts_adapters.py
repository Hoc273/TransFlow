"""CEP Phase A1.2 provider-specific tests — Piper / Google / Azure adapters.

Covers:
* Piper: catalog == V32 seed asset keys; lazy piper-tts import + model cache;
  PIPER_SEMAPHORE concurrency cap (TC-CEP-08).
* Google: request shape (URL, X-Goog-Api-Key, JSON body), error mapping,
  empty-response handling.
* Azure: SSML body shape incl. XML escaping, Ocp-Apim header, error mapping.
* Static catalogs and registry registration.
* Gateway execution_info completion per segment (TC-CEP-09).
"""
from __future__ import annotations

import asyncio
import base64
import json
import sys
import threading
import unittest
from pathlib import Path
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
from app.services.protocol.piper import (
    _MODEL_CACHE,
    _PIPER_SEMAPHORE,
    _find_model_files,
    _load_piper_voice,
    PiperAdapter,
)
from app.services.protocol.static_voices import (
    AZURE_TTS_VOICES,
    GOOGLE_TTS_VOICES,
    PIPER_VOICES,
    PIPER_VOICE_MODELS,
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

V32_PIPER_ASSET_KEYS = {
    "piper-vi-vais1000", "piper-vi-25hours", "piper-vi-vivos",
    "piper-en-amy", "piper-en-joe", "piper-en-alan",
}


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


# ── Piper ────────────────────────────────────────────────────────────────────

class _FakePiperVoice:
    def __init__(self, marker: str, sample_rate: int = 22050) -> None:
        self.marker = marker
        self.config = SimpleNamespace(sample_rate=sample_rate)

    def synthesize(self, text: str, wav_file) -> None:
        wav_file.writeframes(f"{self.marker}:{text}".encode())


class _FakePiperModule:
    class PiperVoice:
        @staticmethod
        def load(onnx_path: Path, config_path=None):
            stem = onnx_path.stem
            # Real model configs: 25hours_single / vivos run at 16000 Hz.
            sample_rate = 16000 if ("25hours_single" in stem or "vivos" in stem) else 22050
            return _FakePiperVoice(stem, sample_rate=sample_rate)


class PiperAdapterTest(unittest.IsolatedAsyncioTestCase):
    def test_catalog_matches_v32_seed(self):
        ids = {voice.voice_id for voice in PIPER_VOICES}
        self.assertEqual(V32_PIPER_ASSET_KEYS, ids)
        self.assertEqual(6, len(ids))
        self.assertEqual(3, sum(1 for i in ids if i.startswith("piper-vi-")))
        self.assertEqual(3, sum(1 for i in ids if i.startswith("piper-en-")))
        self.assertEqual(ids, set(PIPER_VOICE_MODELS))
        # Gender parity with the V32 seed metadata: vi models publish no gender
        # (MODEL_CARD does not state it) → None; en models keep known genders.
        by_id = {voice.voice_id: voice.gender for voice in PIPER_VOICES}
        self.assertIsNone(by_id["piper-vi-vais1000"])
        self.assertIsNone(by_id["piper-vi-25hours"])
        self.assertIsNone(by_id["piper-vi-vivos"])
        self.assertEqual("FEMALE", by_id["piper-en-amy"])
        self.assertEqual("MALE", by_id["piper-en-joe"])
        self.assertEqual("MALE", by_id["piper-en-alan"])

    def test_piper_not_imported_at_module_load(self):
        # Lazy import: the piper-tts package must not be touched at import time
        # (it is only installed in the Docker image).
        self.assertNotIn("piper", sys.modules)

    async def test_lazy_load_and_model_cache(self):
        fake_piper = SimpleNamespace(PiperVoice=_FakePiperModule.PiperVoice)
        fake_onnx = Path("/models/vi_VN-vais1000-medium.onnx")
        lookups = {"count": 0}
        _MODEL_CACHE.clear()
        with patch.dict(sys.modules, {"piper": fake_piper}):
            def _fake_find(model_stem):
                lookups["count"] += 1
                return (fake_onnx, Path("/models/vi_VN-vais1000-medium.onnx.json"))

            with patch("app.services.protocol.piper._find_model_files", side_effect=_fake_find):
                adapter = PiperAdapter()
                result = await adapter._synthesize_engine(
                    _provider("local_piper"), "chào", "piper-vi-vais1000"
                )
                second = await adapter._synthesize_engine(
                    _provider("local_piper"), "chào lần hai", "piper-vi-vais1000"
                )
        try:
            # Same loaded voice instance is reused (cache) — marker embeds model
            # stem; the output is a valid WAV (RIFF header wraps the payload).
            self.assertTrue(result.audio_bytes.startswith(b"RIFF"))
            self.assertIn(("vi_VN-vais1000-medium:chào").encode("utf-8"), result.audio_bytes)
            self.assertIn(("vi_VN-vais1000-medium:chào lần hai").encode("utf-8"), second.audio_bytes)
            self.assertEqual("audio/wav", result.mime_type)
            # Sample rate comes from the loaded voice config, not a hardcode.
            self.assertEqual(22050, result.sample_rate)
            # Model files resolved once — the second call hits the cache.
            self.assertEqual(1, lookups["count"])
        finally:
            _MODEL_CACHE.clear()

    async def test_synthesize_engine_wraps_wave_writer_and_reports_real_sample_rate(self):
        # P0-2: piper voice.synthesize needs a wave.Wave_write object (real
        # writers expose write()); a raw BytesIO would raise AttributeError.
        _MODEL_CACHE.clear()
        fake_piper = SimpleNamespace(PiperVoice=_FakePiperModule.PiperVoice)
        with patch.dict(sys.modules, {"piper": fake_piper}):
            with patch(
                "app.services.protocol.piper._find_model_files",
                return_value=(
                    Path("/models/vi_VN-vivos-x_low.onnx"),
                    Path("/models/vi_VN-vivos-x_low.onnx.json"),
                ),
            ):
                adapter = PiperAdapter()
                result = await adapter._synthesize_engine(
                    _provider("local_piper"), "chào", "piper-vi-vivos"
                )
        try:
            self.assertTrue(result.audio_bytes.startswith(b"RIFF"))
            self.assertEqual(16000, result.sample_rate)
            self.assertEqual("audio/wav", result.mime_type)
        finally:
            _MODEL_CACHE.clear()

    async def test_missing_model_files_fail_fast(self):
        fake_piper = SimpleNamespace(PiperVoice=_FakePiperModule.PiperVoice)
        with patch.dict(sys.modules, {"piper": fake_piper}):
            with patch(
                "app.services.protocol.piper._find_model_files",
                side_effect=ProviderValidation(
                    "not bundled",
                    code=ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND,
                    protocol="local_piper",
                    capability="TTS",
                ),
            ):
                adapter = PiperAdapter()
                with self.assertRaises(ProviderValidation) as ctx:
                    await adapter._synthesize_engine(
                        _provider("local_piper"), "chào", "piper-vi-vais1000"
                    )
                self.assertEqual(ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND, ctx.exception.code)

    async def test_discover_voices_intersects_catalog_with_bundled_models(self):
        # Only voices whose model files are actually on disk are advertised —
        # seeded-but-missing models are dropped (no phantom voices).
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "vi" / "vais1000" / "medium").mkdir(parents=True)
            (root / "vi" / "vais1000" / "medium" / "vi_VN-vais1000-medium.onnx").write_bytes(b"m")
            (root / "en" / "amy" / "medium").mkdir(parents=True)
            (root / "en" / "amy" / "medium" / "en_US-amy-medium.onnx").write_bytes(b"m")
            with patch("app.core.config.settings.piper_voices_dir", tmp):
                discovery = await PiperAdapter().discover_voices(_provider("local_piper"))
        ids = {v.voice_id for v in discovery.voices}
        self.assertEqual({"piper-vi-vais1000", "piper-en-amy"}, ids)

    def test_find_model_files_looks_below_voices_dir(self):
        with patch("app.core.config.settings.piper_voices_dir", "piper/voices"):
            # Directories: build a temp tree under the temp dir.
            import tempfile

            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "vi").mkdir()
                onnx = root / "vi" / "vi_VN-x-medium.onnx"
                onnx.write_bytes(b"model")
                json_cfg = root / "vi" / "vi_VN-x-medium.onnx.json"
                json_cfg.write_text("{}")
                with patch("app.core.config.settings.piper_voices_dir", tmp):
                    onnx_found, cfg_found = _find_model_files("vi_VN-x-medium")
                self.assertEqual(onnx, onnx_found)
                self.assertEqual(json_cfg, cfg_found)

    def test_semaphore_caps_concurrent_synthesis(self):
        # TC-CEP-08: with PIPER_SEMAPHORE=2, 3 concurrent calls → max 2 in-flight.
        state = {"active": 0, "max": 0}
        lock = threading.Lock()
        release = threading.Event()

        class _BlockingVoice:
            config = SimpleNamespace(sample_rate=22050)

            def synthesize(self, text: str, wav_file) -> None:
                with lock:
                    state["active"] += 1
                    state["max"] = max(state["max"], state["active"])
                release.wait(timeout=5)
                with lock:
                    state["active"] -= 1
                wav_file.writeframes(b"x")

        _MODEL_CACHE.clear()
        adapter = PiperAdapter()
        with patch(
            "app.services.protocol.piper._load_piper_voice",
            side_effect=lambda stem: _BlockingVoice(),
        ):
            async def main():
                tasks = [
                    asyncio.create_task(
                        adapter._synthesize_engine(_provider("local_piper"), "a", "piper-vi-vais1000")
                    )
                    for _ in range(3)
                ]
                await asyncio.sleep(0.3)
                max_seen = state["max"]
                release.set()
                await asyncio.gather(*tasks)
                return max_seen

            max_seen = asyncio.run(main())
        _MODEL_CACHE.clear()
        self.assertEqual(2, max_seen, "semaphore must cap concurrent synthesis at PIPER_SEMAPHORE")
        self.assertEqual(0, state["active"])


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

    def test_registry_registers_all_three(self):
        protocols = set(registry_module.get_registry().protocols())
        self.assertTrue({"local_piper", "google_speech", "azure_speech"} <= protocols)
        adapter = registry_module.require_adapter("local_piper", capability="TTS")
        self.assertIsInstance(adapter, PiperAdapter)


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
            provider="local_piper",
            model="vi_VN-vais1000-medium",
            voice="piper-vi-vais1000",
            cache=CacheInfo(hit=False, source=None),
            latency_ms=12,
            request_id="abc123",
        )
        payload = json.loads(info.model_dump_json(by_alias=True))
        # Wire shape is camelCase (ADR-CEP §9): latency_ms → latencyMs,
        # request_id → requestId.
        self.assertEqual("local_piper", payload["provider"])
        self.assertFalse(payload["cache"]["hit"])
        self.assertEqual(12, payload["latencyMs"])
        self.assertEqual("abc123", payload["requestId"])
        self.assertNotIn("latency_ms", payload)
        self.assertNotIn("request_id", payload)
        self.assertNotIn("api_key", payload)


# ── Gateway zero-key gate (P0-1) ──────────────────────────────────────────────

class GatewayKeyGateTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        patcher = patch("app.services.tts_gateway.get_cache", return_value=NoopGeneratedAssetCache())
        patcher.start()
        self.addCleanup(patcher.stop)

    def _adapter(self, requires_key: bool) -> SimpleNamespace:
        return SimpleNamespace(requires_api_key=requires_key)

    def test_zero_key_adapter_never_mocked_without_key(self):
        # local_piper with empty api_key, real mode → real adapter path.
        self.assertFalse(
            tts_gateway_module._should_mock(
                _provider("local_piper").model_copy(update={"api_key": ""}),
                self._adapter(requires_key=False),
            )
        )

    def test_key_requiring_adapter_mocked_without_key(self):
        # google_speech / azure_speech with empty api_key → mock (FALLBACK).
        self.assertTrue(
            tts_gateway_module._should_mock(
                _provider("google_speech").model_copy(update={"api_key": ""}),
                self._adapter(requires_key=True),
            )
        )

    def test_mock_mode_wins_even_for_zero_key(self):
        with patch("app.core.config.settings.mock_mode", True):
            self.assertTrue(
                tts_gateway_module._should_mock(
                    _provider("local_piper"),
                    self._adapter(requires_key=False),
                )
            )

    async def test_gateway_dispatches_zero_key_piper_without_api_key(self):
        # P0-1 end-to-end: synthesize() must run the adapter for local_piper
        # even when api_key is empty and mock_mode is False.
        called = {"n": 0}

        async def fake_synthesize(provider, text, voice_id):
            called["n"] += 1
            return SynthesizeResult(
                audio_bytes=b"wav",
                mime_type="audio/wav",
                metadata={"execution_info": {"provider": "local_piper"}},
            )

        fake_adapter = SimpleNamespace(
            synthesize=fake_synthesize,
            requires_api_key=False,
            protocol="local_piper",
        )
        request = TtsRequest(
            correlation_id="corr-0",
            media_job_id="job-0",
            voice_id="piper-vi-vais1000",
            segments=[TtsSegment(segment_id="s1", target_text="Xin chào")],
            provider=_provider("local_piper").model_copy(update={"api_key": ""}),
        )
        with patch("app.services.tts_gateway.require_adapter", return_value=fake_adapter):
            response = await gateway_synthesize(request)
        self.assertEqual(1, called["n"])
        self.assertEqual("COMPLETED", response.status)
        self.assertEqual("SUCCESS", response.results[0].status)


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

    def test_zero_key_piper_and_key_requiring_adapters(self):
        from app.services.protocol.registry import get_registry
        by_protocol = {a.protocol: a for a in get_registry().adapters()}
        self.assertFalse(by_protocol["local_piper"].requires_api_key)
        self.assertTrue(by_protocol["openai_compatible"].requires_api_key)
        self.assertTrue(by_protocol["dashscope_native"].requires_api_key)
        self.assertTrue(by_protocol["elevenlabs_native"].requires_api_key)
        self.assertTrue(by_protocol["google_speech"].requires_api_key)
        self.assertTrue(by_protocol["azure_speech"].requires_api_key)
