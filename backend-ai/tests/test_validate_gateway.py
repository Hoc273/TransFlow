"""Tests for 4-phase provider validation gateway (docs/07 ¬ßL, Q-PV-*)."""
from __future__ import annotations

import struct
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services.validate_gateway import (
    _generate_tiny_wav,
    tiny_wav_bytes,
    _normalize_base_url,
    _auth_probe_path,
    probe_connection,
    probe_auth,
    _probe_voice_discovery,
    _probe_model_discovery,
    probe_vision_capability,
)
from app.schemas.validate import (
    ConnectionProbeRequest,
    AuthProbeRequest,
    OptionalFeatureResult,
    TtsProbeRequest,
    VisionProbeRequest,
)
from app.schemas.contract import ProviderPayload
from app.services.protocol.static_voices import default_probe_voice_for_protocol


# ‚îÄ‚îÄ Tiny WAV generator ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ

class TestTinyWav:
    def test_generates_valid_riff_header(self):
        wav = _generate_tiny_wav()
        assert wav[:4] == b"RIFF"
        assert wav[8:12] == b"WAVE"
        assert wav[12:16] == b"fmt "

    def test_wav_has_data_chunk(self):
        wav = _generate_tiny_wav()
        # Find "data" marker
        data_offset = wav.find(b"data")
        assert data_offset >= 0

    def test_wav_duration_approximately_500ms(self):
        wav = _generate_tiny_wav()
        # Parse sample rate from fmt chunk
        # fmt chunk starts at offset 12, data at offset 16 within fmt
        sample_rate = struct.unpack_from("<I", wav, 24)[0]
        assert sample_rate == 8000
        # 4000 samples at 8000Hz = 500ms
        data_offset = wav.find(b"data")
        data_size = struct.unpack_from("<I", wav, data_offset + 4)[0]
        num_samples = data_size // 2  # 16-bit mono
        assert num_samples == 4000

    def test_wav_contains_audible_tone_not_silence(self):
        """Probe audio must be non-silent so STT providers return segments."""
        wav = _generate_tiny_wav()
        data_offset = wav.find(b"data")
        data_size = struct.unpack_from("<I", wav, data_offset + 4)[0]
        pcm = wav[data_offset + 8 : data_offset + 8 + data_size]
        nonzero = sum(1 for i in range(0, len(pcm), 2) if pcm[i : i + 2] != b"\x00\x00")
        assert nonzero > len(pcm) // 4

    def test_tiny_wav_bytes_caches_result(self):
        first = tiny_wav_bytes()
        second = tiny_wav_bytes()
        assert first == second


# ‚îÄ‚îÄ Phase 2: AUTH probe (unit tests) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ

class TestAuthProbe:
    """Unit tests for auth endpoint routing (no real HTTP calls)."""

    def test_auth_headers_cover_registered_adapters(self):
        """Every registered protocol adapter must expose auth headers."""
        from app.services.validate_gateway import _AUTH_HEADER_TEMPLATES
        expected_protocols = [
            "openai_compatible",
            "anthropic",
            "elevenlabs_native",
            "dashscope_native",
            "google_speech",
            "azure_speech",
        ]
        for protocol in expected_protocols:
            assert protocol in _AUTH_HEADER_TEMPLATES, f"Missing auth headers for {protocol}"

    def test_auth_headers_contain_key_placeholder(self):
        from app.services.validate_gateway import _AUTH_HEADER_TEMPLATES
        for protocol, headers in _AUTH_HEADER_TEMPLATES.items():
            # local_piper is the zero-key System tier ‚Äî no auth headers by design.
            if protocol == "local_piper":
                assert headers == {}, "local_piper must not fabricate auth headers"
                continue
            # At least one header value should carry the key (Bearer / xi-api-key / x-api-key).
            values = " ".join(headers.values())
            assert "{key}" in values or any(
                h for h in headers.values() if h
            ), f"Empty auth headers for {protocol}"
        assert "X-Goog-Api-Key" in _AUTH_HEADER_TEMPLATES["google_speech"]
        assert "Ocp-Apim-Subscription-Key" in _AUTH_HEADER_TEMPLATES["azure_speech"]

    def test_auth_probe_path_avoids_duplicate_v1(self):
        """openai_compatible base URLs ending with /v1 should use /models, not /v1/models."""
        assert _auth_probe_path("openai_compatible", "https://api.openai.com/v1") == "/models"
        assert _auth_probe_path("openai_compatible", "https://api.openai.com/v1/") == "/models"
        assert _auth_probe_path("openai_compatible", "https://opencode.ai/zen/go/v1") == "/models"

    def test_auth_probe_path_adds_v1_when_missing(self):
        """openai_compatible base URLs WITHOUT /v1 should get /v1/models."""
        assert _auth_probe_path("openai_compatible", "http://localhost:8000") == "/v1/models"
        assert _auth_probe_path("openai_compatible", "https://api.example.com") == "/v1/models"

    def test_auth_probe_path_anthropic(self):
        assert _auth_probe_path("anthropic", "https://api.anthropic.com") == "/v1/messages"

    def test_auth_probe_path_other_protocols(self):
        assert _auth_probe_path("elevenlabs_native", "https://api.elevenlabs.io") == "/voices"
        assert _auth_probe_path("dashscope_native", "https://dashscope.aliyuncs.com/compatible-mode/v1") == "/models"
        # Registered speech adapters expose their cheap list endpoint as the probe.
        assert _auth_probe_path("google_speech", "https://texttospeech.googleapis.com") == "/v1/voices"
        assert _auth_probe_path("google_speech", "https://texttospeech.googleapis.com/v1") == "/voices"
        assert _auth_probe_path("azure_speech", "https://eastus.tts.speech.microsoft.com") == "/cognitiveservices/voices/list"
        # Zero-key System tier (local_piper) has no auth probe.
        assert _auth_probe_path("local_piper", "https://piper.local") == ""
        # Unregistered placeholder protocols return empty path (no adapter).
        assert _auth_probe_path("amazon_polly", "https://polly.example") == ""

    def test_normalize_base_url_strips_trailing_slash(self):
        assert _normalize_base_url("https://api.openai.com/v1/") == "https://api.openai.com/v1"
        assert _normalize_base_url("https://api.openai.com/v1") == "https://api.openai.com/v1"

    def test_normalize_base_url_collapses_double_slashes(self):
        assert _normalize_base_url("https://api.example.com//v1//models") == "https://api.example.com/v1/models"


# ‚îÄ‚îÄ Phase 4: Optional features (unit tests) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ

class TestOptionalFeatureProbes:
    """Unit tests for optional feature availability logic (no real HTTP)."""

    def test_voice_discovery_strategy_per_adapter(self):
        """Voice discovery strategy is declared on the adapter, not via if/else gates."""
        from app.services.protocol import require_adapter, VoiceDiscoveryStrategy

        assert require_adapter("elevenlabs_native").voice_discovery_strategy == VoiceDiscoveryStrategy.AUTO
        assert require_adapter("dashscope_native").voice_discovery_strategy == VoiceDiscoveryStrategy.STATIC
        assert require_adapter("openai_compatible").voice_discovery_strategy == VoiceDiscoveryStrategy.MANUAL
        assert require_adapter("anthropic").voice_discovery_strategy == VoiceDiscoveryStrategy.UNSUPPORTED

    def test_model_discovery_via_adapter(self):
        """Model discovery is adapter-owned ‚Äî registry lookup, no protocol if/else."""
        from app.services.protocol import get_adapter

        assert get_adapter("openai_compatible") is not None
        assert get_adapter("dashscope_native") is not None
        assert get_adapter("anthropic") is not None


# ‚îÄ‚îÄ Connection probe (unit tests) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ

class TestConnectionProbe:
    """Test the connection probe request schema."""

    def test_connection_probe_request_fields(self):
        req = ConnectionProbeRequest(base_url="https://api.openai.com/v1", protocol="openai_compatible")
        assert req.base_url == "https://api.openai.com/v1"
        assert req.protocol == "openai_compatible"

    def test_auth_probe_request_fields(self):
        req = AuthProbeRequest(protocol="openai_compatible", base_url="https://api.openai.com/v1", api_key="sk-test")
        assert req.api_key == "sk-test"
        assert req.protocol == "openai_compatible"


# ‚îÄ‚îÄ TTS probe voice resolution (Q-PV-14) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ

class TestTtsProbeVoiceResolution:
    def test_tts_probe_request_voice_optional(self):
        req = TtsProbeRequest(
            provider=ProviderPayload(
                protocol="dashscope_native",
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                api_key="sk-test",
                model="qwen3.5-omni-plus",
            )
        )
        assert req.voice_id is None
        assert req.text == "Hi"

    def test_default_probe_voice_dashscope_serena(self):
        from app.services.protocol import require_adapter

        adapter = require_adapter("dashscope_native", capability="TTS")
        assert adapter.default_probe_voice == "Serena"
        assert default_probe_voice_for_protocol("dashscope_native") == "Serena"

    def test_default_probe_voice_openai_alloy(self):
        from app.services.protocol import require_adapter

        adapter = require_adapter("openai_compatible", capability="TTS")
        assert adapter.default_probe_voice == "alloy"
        assert default_probe_voice_for_protocol("openai_compatible") == "alloy"


# ‚îÄ‚îÄ Optional feature result ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ

class TestOptionalFeatureResult:
    def test_available_result(self):
        r = OptionalFeatureResult(available=True, detail="15 models")
        assert r.available is True
        assert r.detail == "15 models"

    def test_unavailable_result(self):
        r = OptionalFeatureResult(available=False, detail="403 ‚Äî voices_read missing")
        assert r.available is False
        assert "voices_read" in r.detail


# ‚îÄ‚îÄ Validate API router ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ

class TestValidateRouter:
    def test_router_has_correct_prefix(self):
        from app.api.validate import validate_router
        assert validate_router.prefix == "/ai/validate"

    def test_router_has_all_6_endpoints(self):
        from app.api.validate import validate_router
        routes = [r.path for r in validate_router.routes]
        # FastAPI includes the router prefix in route paths
        prefix = validate_router.prefix
        assert f"{prefix}/connection" in routes
        assert f"{prefix}/auth" in routes
        assert f"{prefix}/stt-probe" in routes
        assert f"{prefix}/tts-probe" in routes
        assert f"{prefix}/vision-probe" in routes
        assert f"{prefix}/features" in routes


class TestVisionProbe(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _provider(capabilities=None):
        return ProviderPayload(
            protocol="openai_compatible",
            base_url="https://provider.test/v1",
            api_key="sk-test",
            model="opaque-model",
            capabilities=capabilities,
        )

    async def test_successful_probe_sends_real_image_data_url(self):
        import app.services.validate_gateway as vg

        class _Adapter:
            def __init__(self):
                self.images = None

            async def chat(self, provider, system, user, **kwargs):
                self.images = kwargs.get("images")
                return SimpleNamespace(text="OK")

        adapter = _Adapter()
        with patch("app.services.validate_gateway.require_adapter", return_value=adapter), \
                patch.object(vg.settings, "mock_mode", False):
            result = await probe_vision_capability(
                VisionProbeRequest(provider=self._provider({"VISION"}))
            )

        assert result.ok is True
        assert result.detected_text == "OK"
        assert adapter.images and adapter.images[0].startswith("data:image/")

    async def test_provider_rejecting_image_input_fails(self):
        import app.services.validate_gateway as vg
        from app.services.provider_errors import ProviderErrorCode, ProviderException

        class _Adapter:
            async def chat(self, provider, system, user, **kwargs):
                raise ProviderException(
                    ProviderErrorCode.PROVIDER_BAD_REQUEST,
                    "image input is not supported",
                    provider=provider.base_url,
                    protocol=provider.protocol,
                    capability="VISION",
                )

        with patch("app.services.validate_gateway.require_adapter", return_value=_Adapter()), \
                patch.object(vg.settings, "mock_mode", False):
            result = await probe_vision_capability(
                VisionProbeRequest(provider=self._provider({"VISION"}))
            )

        assert result.ok is False
        assert "image input" in result.message

    async def test_declared_text_only_provider_fails_before_image_call(self):
        import app.services.validate_gateway as vg
        from app.services.protocol.openai_compatible import OpenAICompatibleAdapter

        with patch("app.services.validate_gateway.require_adapter", return_value=OpenAICompatibleAdapter()), \
                patch.object(vg.settings, "mock_mode", False):
            result = await probe_vision_capability(
                VisionProbeRequest(provider=self._provider({"TEXT"}))
            )

        assert result.ok is False
        assert "capability VISION" in result.message

# -- Phase D P2: zero-key TTS probe gate -------------------------------------

class TestTtsProbeKeyGate(unittest.IsolatedAsyncioTestCase):
    """Zero-key adapters (requires_api_key=False, e.g. local_piper) must never be
    probe-skipped on an empty/placeholder key ó mirrors tts_gateway.py's gate."""

    class _FakeAdapter:
        def __init__(self, requires_api_key: bool):
            self.requires_api_key = requires_api_key
            self.synthesized = 0

        async def synthesize(self, provider, text, voice_id):
            self.synthesized += 1
            return SimpleNamespace(audio_bytes=b"RIFF....WAVE....")

    @staticmethod
    def _piper_provider() -> ProviderPayload:
        return ProviderPayload(
            protocol="local_piper",
            base_url="system://piper",
            api_key="",
            model="piper",
        )

    async def _probe(self, adapter, provider):
        import app.services.validate_gateway as vg
        with patch("app.services.validate_gateway.require_adapter", return_value=adapter), \
                patch.object(vg.settings, "mock_mode", False):
            return await vg.probe_tts_capability(
                TtsProbeRequest(provider=provider, voice_id="piper-vi-vais1000")
            )

    async def test_zero_key_adapter_synthesizes_with_empty_key(self):
        adapter = self._FakeAdapter(requires_api_key=False)
        resp = await self._probe(adapter, self._piper_provider())
        assert resp.ok is True
        assert adapter.synthesized == 1
        assert "successful" in resp.message
        assert resp.audio_bytes > 0

    async def test_key_requiring_adapter_skipped_with_empty_key(self):
        adapter = self._FakeAdapter(requires_api_key=True)
        provider = ProviderPayload(
            protocol="openai_compatible",
            base_url="https://example.com/v1",
            api_key="",
            model="tts-1",
        )
        resp = await self._probe(adapter, provider)
        assert resp.ok is True
        assert adapter.synthesized == 0
        assert "skipped" in resp.message

    async def test_mock_mode_wins_even_for_zero_key(self):
        import app.services.validate_gateway as vg
        adapter = self._FakeAdapter(requires_api_key=False)
        with patch("app.services.validate_gateway.require_adapter", return_value=adapter), \
                patch.object(vg.settings, "mock_mode", True):
            resp = await vg.probe_tts_capability(
                TtsProbeRequest(provider=self._piper_provider(), voice_id="piper-vi-vais1000")
            )
        assert resp.ok is True
        assert adapter.synthesized == 0
        assert "skipped" in resp.message

    async def test_unknown_protocol_fails_before_key_gate(self):
        import app.services.validate_gateway as vg
        from app.services.provider_errors import ProviderException, ProviderErrorCode

        def _raise(protocol, capability):
            raise ProviderException(
                ProviderErrorCode.PROVIDER_UNKNOWN, "no adapter for nope",
                protocol=protocol, capability=capability,
            )

        with patch("app.services.validate_gateway.require_adapter", side_effect=_raise), \
                patch.object(vg.settings, "mock_mode", False):
            resp = await vg.probe_tts_capability(
                TtsProbeRequest(provider=self._piper_provider(), voice_id="piper-vi-vais1000")
            )
        assert resp.ok is False
        assert "no adapter" in resp.message

# -- STT probe no-speech retry (2026-08-14) ----------------------------------

class TestSttProbeNoSpeechRetry(unittest.IsolatedAsyncioTestCase):
    """The probe audio is a synthetic 440Hz tone, not speech — the LLM-based ASR
    (DashScope Qwen-Omni) occasionally returns a valid empty transcript ("no
    speech"). The probe retries once on PROVIDER_EMPTY_RESPONSE before
    declaring the provider unhealthy; any other failure fails fast."""

    class _FakeAdapter:
        def __init__(self, transcriptions):
            self.transcriptions = list(transcriptions)
            self.calls = 0

        async def transcribe(self, provider, audio):
            self.calls += 1
            outcome = self.transcriptions.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return SimpleNamespace(segments=outcome)

    @staticmethod
    def _provider() -> ProviderPayload:
        return ProviderPayload(
            protocol="dashscope_native",
            base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            api_key="sk-ws-test",
            model="qwen3.5-omni-plus",
        )

    async def _probe(self, adapter):
        import app.services.validate_gateway as vg
        from app.schemas.validate import SttProbeRequest
        with patch("app.services.validate_gateway.require_adapter", return_value=adapter), \
                patch.object(vg.settings, "mock_mode", False):
            return await vg.probe_stt_capability(SttProbeRequest(provider=self._provider()))

    @staticmethod
    def _segment(text):
        from app.services.protocol.dashscope_native import SttSegment
        return SttSegment(text=text, start_ms=0, end_ms=400)

    async def test_retries_once_on_no_speech_then_succeeds(self):
        from app.services.provider_errors import ProviderErrorCode, ProviderValidation
        empty = ProviderValidation(
            "DashScope STT detected no speech in the audio",
            code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
            provider="p", protocol="dashscope_native", capability="STT",
        )
        adapter = self._FakeAdapter([empty, [self._segment("Beep.")]])
        resp = await self._probe(adapter)

        assert resp.ok is True
        assert resp.detected_text == "Beep."
        assert adapter.calls == 2

    async def test_two_no_speech_responses_fail_with_clear_message(self):
        from app.services.provider_errors import ProviderErrorCode, ProviderValidation
        empty = ProviderValidation(
            "DashScope STT detected no speech in the audio",
            code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
            provider="p", protocol="dashscope_native", capability="STT",
        )
        adapter = self._FakeAdapter([empty, empty])
        resp = await self._probe(adapter)

        assert resp.ok is False
        assert "no speech" in resp.message
        assert resp.error_detail.errorCode == "PROVIDER_EMPTY_RESPONSE"
        assert resp.error_detail.protocol == "dashscope_native"
        assert resp.error_detail.capability == "STT"
        assert resp.error_detail.model == "qwen3.5-omni-plus"
        assert adapter.calls == 2

    async def test_malformed_fails_fast_without_retry(self):
        from app.services.provider_errors import ProviderErrorCode, ProviderValidation
        malformed = ProviderValidation(
            "DashScope STT response requires detected_lang and timed segments",
            code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
            provider="p", protocol="dashscope_native", capability="STT",
        )
        adapter = self._FakeAdapter([malformed])
        resp = await self._probe(adapter)

        assert resp.ok is False
        assert "requires detected_lang" in resp.message
        assert adapter.calls == 1
