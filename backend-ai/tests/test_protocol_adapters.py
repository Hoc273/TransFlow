"""Protocol adapter registry + DashScope / capability dispatch tests."""
from __future__ import annotations

import base64
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from app.schemas.contract import ProviderPayload
from app.services.protocol import (
    AudioInput,
    Capability,
    VoiceDiscoveryStrategy,
    get_adapter,
    get_registry,
    require_adapter,
)
from app.services.protocol.dashscope_native import DashScopeNativeAdapter
from app.services.protocol.openai_compatible import OpenAICompatibleAdapter
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderException,
    ProviderValidation,
)


def _provider(protocol: str, model: str = "test-model", **kwargs) -> ProviderPayload:
    return ProviderPayload(
        protocol=protocol,  # type: ignore[arg-type]
        base_url=kwargs.get("base_url", "https://provider.test/v1"),
        api_key=kwargs.get("api_key", "sk-test"),
        model=model,
        capabilities=kwargs.get("capabilities"),
    )


class RegistryTest(unittest.TestCase):
    def test_registered_protocols(self):
        protocols = set(get_registry().protocols())
        self.assertIn("openai_compatible", protocols)
        self.assertIn("anthropic", protocols)
        self.assertIn("elevenlabs_native", protocols)
        self.assertIn("dashscope_native", protocols)

    def test_require_adapter_unknown(self):
        with self.assertRaises(ProviderException):
            require_adapter("not_a_protocol")

    def test_dashscope_supports_text_stt_tts(self):
        adapter = require_adapter("dashscope_native")
        self.assertTrue(adapter.supports(Capability.TEXT))
        self.assertTrue(adapter.supports(Capability.STT))
        self.assertTrue(adapter.supports(Capability.TTS))
        self.assertEqual(adapter.voice_discovery_strategy, VoiceDiscoveryStrategy.STATIC)

    def test_openai_manual_voice_strategy(self):
        adapter = require_adapter("openai_compatible")
        self.assertEqual(adapter.voice_discovery_strategy, VoiceDiscoveryStrategy.MANUAL)

    def test_elevenlabs_auto_voice_strategy(self):
        adapter = require_adapter("elevenlabs_native")
        self.assertEqual(adapter.voice_discovery_strategy, VoiceDiscoveryStrategy.AUTO)

    def test_require_capability_gate(self):
        with self.assertRaises(ProviderException):
            require_adapter("anthropic", capability="TTS")


class OpenAICompatibleAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_synthesize_returns_synthesize_result(self):
        response = httpx.Response(200, content=b"mp3-bytes")

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                self.url = url
                self.kwargs = kwargs
                return response

        client = _Client()
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().synthesize(
                _provider("openai_compatible", "tts-1", capabilities={"TTS"}),
                "hello",
                "alloy",
            )

        self.assertEqual(b"mp3-bytes", result.audio_bytes)
        self.assertEqual("audio/mpeg", result.mime_type)
        self.assertTrue(client.url.endswith("/audio/speech"))


class DashScopeNativeAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_static_voices_from_registry(self):
        discovery = await DashScopeNativeAdapter().discover_voices(
            _provider("dashscope_native", "qwen-omni-turbo")
        )
        self.assertEqual(VoiceDiscoveryStrategy.STATIC, discovery.strategy)
        self.assertEqual("STATIC", discovery.mode)
        # Turbo official set is only 4 voices — must not expose flash-only Elias.
        self.assertGreaterEqual(len(discovery.voices), 4)
        ids = {v.voice_id for v in discovery.voices}
        self.assertIn("Serena", ids)
        self.assertIn("Ethan", ids)
        self.assertNotIn("Elias", ids)
        # Safe cross-model default first (Q-PV-14)
        self.assertEqual("Serena", discovery.voices[0].voice_id)
        self.assertEqual("Serena", DashScopeNativeAdapter().default_probe_voice)

    async def test_qwen35_catalog_excludes_elias_includes_tina(self):
        discovery = await DashScopeNativeAdapter().discover_voices(
            _provider("dashscope_native", "qwen3.5-omni-plus")
        )
        ids = {v.voice_id for v in discovery.voices}
        self.assertIn("Tina", ids)
        self.assertIn("Serena", ids)
        self.assertNotIn("Elias", ids)

    async def test_flash_catalog_includes_elias(self):
        discovery = await DashScopeNativeAdapter().discover_voices(
            _provider("dashscope_native", "qwen3-omni-flash")
        )
        ids = {v.voice_id for v in discovery.voices}
        self.assertIn("Elias", ids)

    async def test_prefers_audio_url(self):
        self.assertTrue(DashScopeNativeAdapter().prefers_audio_url())
        self.assertFalse(OpenAICompatibleAdapter().prefers_audio_url())

    async def test_transcribe_sends_input_audio_url_via_sse(self):
        """Qwen-Omni requires stream=True; public URLs go in input_audio.data as-is."""
        transcript = {
            "detected_lang": "en",
            "segments": [
                {"text": "hello", "start_ms": 0, "end_ms": 500},
                {"text": "world transcript", "start_ms": 500, "end_ms": 1400},
            ],
        }
        payload_text = json.dumps(transcript)
        lines = [
            f'data: {json.dumps({"choices": [{"delta": {"content": payload_text[:30]}}]})}',
            f'data: {json.dumps({"choices": [{"delta": {"content": payload_text[30:]}}]})}',
            "data: [DONE]",
        ]

        class _StreamResponse:
            status_code = 200
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            async def aiter_lines(self):
                for line in lines:
                    yield line

            async def aread(self):
                return b""

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        class _Client:
            def __init__(self):
                self.kwargs = None
                self.url = None

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def stream(self, method, url, **kwargs):
                self.method = method
                self.url = url
                self.kwargs = kwargs
                return _StreamResponse()

        client = _Client()
        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=client):
            result = await DashScopeNativeAdapter().transcribe(
                _provider("dashscope_native", "qwen-omni-turbo"),
                AudioInput.from_url("https://storage.example/audio.wav"),
                source_lang="en",
            )

        self.assertEqual(["hello", "world transcript"], [s.text for s in result.segments])
        self.assertEqual("en", result.detected_lang)
        self.assertEqual(1400, result.segments[-1].end_ms)
        body = client.kwargs["json"]
        self.assertEqual(["text"], body["modalities"])
        self.assertTrue(body["stream"])
        content = body["messages"][0]["content"]
        audio_part = next(p for p in content if p.get("type") == "input_audio")
        self.assertEqual("https://storage.example/audio.wav", audio_part["input_audio"]["data"])
        self.assertEqual("wav", audio_part["input_audio"]["format"])

    async def test_transcribe_bytes_uses_data_uri_prefix(self):
        """Raw base64 is rejected by DashScope as invalid URL — must use data:;base64,."""
        transcript = json.dumps({
            "detected_lang": "vi",
            "segments": [{"text": "ok", "start_ms": 10, "end_ms": 410}],
        })
        lines = [
            f'data: {json.dumps({"choices": [{"delta": {"content": transcript}}]})}',
            "data: [DONE]",
        ]

        class _StreamResponse:
            status_code = 200
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            async def aiter_lines(self):
                for line in lines:
                    yield line

            async def aread(self):
                return b""

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        class _Client:
            def __init__(self):
                self.kwargs = None

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def stream(self, *a, **kwargs):
                self.kwargs = kwargs
                return _StreamResponse()

        client = _Client()
        wav = b"RIFF....WAVEfmt "  # minimal marker; content not validated by adapter
        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=client):
            result = await DashScopeNativeAdapter().transcribe(
                _provider("dashscope_native", "qwen-omni-turbo"),
                AudioInput.from_bytes(wav, filename="probe.wav", mime_type="audio/wav"),
            )

        self.assertEqual("ok", result.segments[0].text)
        audio_part = next(
            p
            for p in client.kwargs["json"]["messages"][0]["content"]
            if p.get("type") == "input_audio"
        )
        data = audio_part["input_audio"]["data"]
        self.assertTrue(data.startswith("data:;base64,"), data[:40])
        self.assertEqual("wav", audio_part["input_audio"]["format"])
        # Payload after prefix must decode back to original bytes
        encoded = data.split(",", 1)[1]
        self.assertEqual(wav, base64.b64decode(encoded))

    async def test_synthesize_buffers_sse_audio(self):
        b64_a = base64.b64encode(b"AAA").decode()
        b64_b = base64.b64encode(b"BBB").decode()
        lines = [
            f'data: {json.dumps({"choices": [{"delta": {"audio": {"data": b64_a, "transcript": "Xin "}}}]})}',
            f'data: {json.dumps({"choices": [{"delta": {"audio": {"data": b64_b, "transcript": "chao"}}}]})}',
            "data: [DONE]",
        ]

        class _StreamResponse:
            status_code = 200
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            async def aiter_lines(self):
                for line in lines:
                    yield line

            async def aread(self):
                return b""

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def stream(self, *a, **k):
                return _StreamResponse()

        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            result = await DashScopeNativeAdapter().synthesize(
                _provider("dashscope_native", "qwen-omni-turbo"),
                "Xin chao",
                "Serena",
            )

        # Raw PCM is wrapped as a real WAV container (RIFF/WAVE + s16le @ 24 kHz).
        self.assertTrue(result.audio_bytes.startswith(b"RIFF"), result.audio_bytes[:16])
        self.assertEqual(b"WAVE", result.audio_bytes[8:12])
        self.assertTrue(result.audio_bytes.endswith(b"AAABBB"))
        self.assertEqual("audio/wav", result.mime_type)
        self.assertEqual("sse", result.metadata.get("transport"))
        self.assertEqual(24000, result.metadata.get("sample_rate"))
        self.assertGreaterEqual(result.metadata.get("duration_seconds"), 0)

    async def test_transcribe_rejects_all_placeholder_segments(self):
        """A transcript whose every segment is a 0-to-0 placeholder yields no
        usable segments — fail closed with PROVIDER_RESPONSE_MALFORMED."""
        payload_text = json.dumps({
            "detected_lang": "vi",
            "segments": [{"text": "khong hop le", "start_ms": 0, "end_ms": 0}],
        })
        lines = [
            f'data: {json.dumps({"choices": [{"delta": {"content": payload_text}}]})}',
            "data: [DONE]",
        ]

        class _StreamResponse:
            status_code = 200
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            async def aiter_lines(self):
                for line in lines:
                    yield line

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def stream(self, *a, **k):
                return _StreamResponse()

        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            with self.assertRaises(ProviderValidation):
                await DashScopeNativeAdapter().transcribe(
                    _provider("dashscope_native", "qwen-omni-turbo"),
                    AudioInput.from_url("https://storage.example/audio.wav"),
                )

    async def test_transcribe_drops_invalid_segments_keeps_valid(self):
        """Placeholder 0-to-0 / empty-text / non-int segments are dropped
        instead of failing the whole transcript (Qwen-Omni non-determinism)."""
        payload_text = json.dumps({
            "detected_lang": "vi",
            "segments": [
                {"text": "leading silence", "start_ms": 0, "end_ms": 0},
                {"text": "", "start_ms": 10, "end_ms": 400},
                {"text": "khong hop le", "start_ms": "0", "end_ms": 400},
                {"text": "hello", "start_ms": 0, "end_ms": 500},
                {"text": "world", "start_ms": 500, "end_ms": 1400},
            ],
        })
        lines = [
            f'data: {json.dumps({"choices": [{"delta": {"content": payload_text}}]})}',
            "data: [DONE]",
        ]

        class _StreamResponse:
            status_code = 200
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            async def aiter_lines(self):
                for line in lines:
                    yield line

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def stream(self, *a, **k):
                return _StreamResponse()

        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            result = await DashScopeNativeAdapter().transcribe(
                _provider("dashscope_native", "qwen-omni-turbo"),
                AudioInput.from_url("https://storage.example/audio.wav"),
            )

        self.assertEqual(["hello", "world"], [s.text for s in result.segments])
        self.assertEqual("vi", result.detected_lang)
        self.assertEqual(0, result.segments[0].start_ms)
        self.assertEqual(500, result.segments[0].end_ms)
        self.assertEqual(1400, result.segments[1].end_ms)

    async def test_transcribe_clamps_non_monotonic_start(self):
        """A segment starting before the previous one is clamped to the
        previous start so the downstream timeline stays monotonic."""
        payload_text = json.dumps({
            "detected_lang": "en",
            "segments": [
                {"text": "first", "start_ms": 1000, "end_ms": 2000},
                {"text": "earlier", "start_ms": 400, "end_ms": 1500},
                {"text": "later", "start_ms": 2100, "end_ms": 2600},
            ],
        })
        lines = [
            f'data: {json.dumps({"choices": [{"delta": {"content": payload_text}}]})}',
            "data: [DONE]",
        ]

        class _StreamResponse:
            status_code = 200
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            async def aiter_lines(self):
                for line in lines:
                    yield line

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def stream(self, *a, **k):
                return _StreamResponse()

        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            result = await DashScopeNativeAdapter().transcribe(
                _provider("dashscope_native", "qwen-omni-turbo"),
                AudioInput.from_url("https://storage.example/audio.wav"),
            )

        starts = [s.start_ms for s in result.segments]
        self.assertEqual([1000, 1000, 2100], starts)
        self.assertEqual(["first", "earlier", "later"], [s.text for s in result.segments])
        self.assertEqual(1500, result.segments[1].end_ms)

    async def test_transcribe_drops_segment_unclampable_after_non_monotonic(self):
        """A non-monotonic segment whose end falls before the clamped start
        cannot be placed on the timeline — drop it, keep the rest."""
        payload_text = json.dumps({
            "detected_lang": "en",
            "segments": [
                {"text": "first", "start_ms": 1000, "end_ms": 2000},
                {"text": "stale", "start_ms": 400, "end_ms": 500},
                {"text": "later", "start_ms": 2100, "end_ms": 2600},
            ],
        })
        lines = [
            f'data: {json.dumps({"choices": [{"delta": {"content": payload_text}}]})}',
            "data: [DONE]",
        ]

        class _StreamResponse:
            status_code = 200
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            async def aiter_lines(self):
                for line in lines:
                    yield line

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def stream(self, *a, **k):
                return _StreamResponse()

        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            result = await DashScopeNativeAdapter().transcribe(
                _provider("dashscope_native", "qwen-omni-turbo"),
                AudioInput.from_url("https://storage.example/audio.wav"),
            )

        self.assertEqual(["first", "later"], [s.text for s in result.segments])
        self.assertEqual([1000, 2100], [s.start_ms for s in result.segments])
        self.assertEqual(2600, result.segments[-1].end_ms)

    async def _run_transcribe(self, payload_text):
        """Shared harness: stream one transcript JSON payload through transcribe."""
        lines = [
            f'data: {json.dumps({"choices": [{"delta": {"content": payload_text}}]})}',
            "data: [DONE]",
        ]

        class _StreamResponse:
            status_code = 200
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            async def aiter_lines(self):
                for line in lines:
                    yield line

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def stream(self, *a, **k):
                return _StreamResponse()

        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            return await DashScopeNativeAdapter().transcribe(
                _provider("dashscope_native", "qwen-omni-turbo"),
                AudioInput.from_url("https://storage.example/audio.wav"),
            )

    async def test_transcribe_empty_segments_is_no_speech_not_malformed(self):
        """A valid JSON transcript with an explicit empty segments array is the
        model's "no speech" verdict (LLM-based ASR, e.g. a tone probe) — it must
        raise PROVIDER_EMPTY_RESPONSE with a clear message, never the misleading
        "requires detected_lang and non-empty timed segments" malformed error."""
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(json.dumps({
                "detected_lang": "en",
                "segments": [],
            }))
        self.assertEqual(
            ProviderErrorCode.PROVIDER_EMPTY_RESPONSE, ctx.exception.code)
        self.assertIn("no speech", str(ctx.exception))

    async def test_transcribe_missing_detected_lang_still_malformed(self):
        """Missing detected_lang (invalid shape) stays PROVIDER_RESPONSE_MALFORMED."""
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(json.dumps({
                "segments": [{"text": "x", "start_ms": 0, "end_ms": 100}],
            }))
        self.assertEqual(
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)
        self.assertIn("requires detected_lang", str(ctx.exception))

    async def test_transcribe_segments_not_a_list_still_malformed(self):
        """segments as a non-list (invalid shape) stays PROVIDER_RESPONSE_MALFORMED."""
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(json.dumps({
                "detected_lang": "en",
                "segments": "no-speech",
            }))
        self.assertEqual(
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)

    async def test_transcribe_all_segments_dropped_stays_malformed(self):
        """Segments present but every one invalid (all dropped) is still a
        malformed response — distinct from the clean empty-transcript verdict."""
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(json.dumps({
                "detected_lang": "en",
                "segments": [
                    {"text": "", "start_ms": 0, "end_ms": 100},
                    {"text": "bad", "start_ms": "0", "end_ms": 100},
                ],
            }))
        self.assertEqual(
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)
        self.assertIn("no usable timed segments", str(ctx.exception))

    async def test_synthesize_rejects_conversational_audio_text(self):
        audio = base64.b64encode(b"AAAA").decode()
        lines = [
            f'data: {json.dumps({"choices": [{"delta": {"content": "Day la cau tra loi moi"}}]})}',
            f'data: {json.dumps({"choices": [{"delta": {"audio": {"data": audio}}}]})}',
            "data: [DONE]",
        ]

        class _StreamResponse:
            status_code = 200
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            async def aiter_lines(self):
                for line in lines:
                    yield line

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def stream(self, *a, **k):
                return _StreamResponse()

        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            with self.assertRaises(ProviderValidation):
                await DashScopeNativeAdapter().synthesize(
                    _provider("dashscope_native", "qwen-omni-turbo"),
                    "Read this exactly",
                    "Serena",
                )

    async def test_chat_uses_chat_completions(self):
        payload = {
            "choices": [{"message": {"content": "OK"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }
        response = httpx.Response(200, json=payload)

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                self.url = url
                return response

        client = _Client()
        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=client):
            result = await DashScopeNativeAdapter().chat(
                _provider("dashscope_native", "qwen-plus"),
                system="sys",
                user="hi",
                max_tokens=8,
            )

        self.assertEqual("OK", result.text)
        self.assertTrue(client.url.endswith("/chat/completions"))


class GatewayNoProtocolBranchTest(unittest.TestCase):
    """Gateways must resolve adapters via registry, not hard-coded protocol lists."""

    def test_get_tts_adapter_dashscope(self):
        from app.services.tts_adapters import get_tts_adapter

        facade = get_tts_adapter("dashscope_native")
        self.assertIsNotNone(facade)

    def test_get_tts_adapter_anthropic_raises(self):
        from app.services.tts_adapters import get_tts_adapter

        with self.assertRaises(ProviderException):
            get_tts_adapter("anthropic")


class OpenAIChatFallbackTest(unittest.IsolatedAsyncioTestCase):
    """Regression for OpenCode Zen DeepSeek V4: content empty, reasoning_content set."""

    async def _post_with_payload(self, payload):
        response = httpx.Response(200, json=payload)

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                return response

        return _Client()

    async def test_chat_falls_back_to_reasoning_content_when_content_empty(self):
        """deepseek-v4-flash-free on Zen returns the reply in reasoning_content."""
        payload = {
            "choices": [{
                "message": {
                    "content": "",
                    "reasoning_content": '{"proposals":[{"proposal_index":1,"cut_ranges":[{"start_ms":0,"end_ms":30000}],"total_duration_ms":30000}]}',
                },
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        }
        client = await self._post_with_payload(payload)
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible", "deepseek-v4-flash-free"),
                system="sys",
                user="hi",
                max_tokens=2048,
            )

        self.assertIn("proposals", result.text)
        self.assertEqual(50, result.usage.output_tokens)

    async def test_chat_returns_empty_when_neither_content_nor_reasoning_content(self):
        payload = {
            "choices": [{
                "message": {"content": "", "reasoning_content": None},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 100, "completion_tokens": 0},
        }
        client = await self._post_with_payload(payload)
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible", "deepseek-v4-flash-free"),
                system="sys",
                user="hi",
            )
        self.assertEqual("", result.text)

    async def test_chat_prefers_content_over_reasoning_content(self):
        payload = {
            "choices": [{
                "message": {
                    "content": "the answer",
                    "reasoning_content": "this is reasoning only, not the answer",
                },
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }
        client = await self._post_with_payload(payload)
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible", "any"),
                system="sys",
                user="hi",
            )
        self.assertEqual("the answer", result.text)

    async def test_chat_accepts_list_content_segments(self):
        """OpenAI multimodal content lists — only text segments contribute to text."""
        payload = {
            "choices": [{
                "message": {
                    "content": [
                        {"type": "text", "text": "hello"},
                        {"type": "image", "image_url": "..."},
                    ],
                    "reasoning_content": None,
                },
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }
        client = await self._post_with_payload(payload)
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible", "gpt-4o"),
                system="sys",
                user="hi",
            )
        self.assertEqual("hello", result.text)


if __name__ == "__main__":
    unittest.main()
