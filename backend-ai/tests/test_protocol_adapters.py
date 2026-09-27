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
        self.assertFalse(adapter.supports(Capability.EMBEDDING))
        self.assertFalse(adapter.supports(Capability.VISION))
        self.assertFalse(adapter.supports(Capability.IMAGE))
        self.assertFalse(adapter.supports(Capability.VIDEO))
        self.assertEqual(adapter.voice_discovery_strategy, VoiceDiscoveryStrategy.STATIC)

    def test_openai_compatible_advertises_vision_not_image_generation(self):
        adapter = require_adapter("openai_compatible")
        self.assertTrue(adapter.supports(Capability.VISION))
        self.assertFalse(adapter.supports(Capability.IMAGE))
        self.assertFalse(adapter.supports(Capability.VIDEO))

    def test_openai_manual_voice_strategy(self):
        adapter = require_adapter("openai_compatible")
        self.assertEqual(adapter.voice_discovery_strategy, VoiceDiscoveryStrategy.MANUAL)

    def test_elevenlabs_auto_voice_strategy(self):
        adapter = require_adapter("elevenlabs_native")
        self.assertEqual(adapter.voice_discovery_strategy, VoiceDiscoveryStrategy.AUTO)

    def test_require_capability_gate(self):
        with self.assertRaises(ProviderException):
            require_adapter("anthropic", capability="TTS")

    def test_provider_capability_gate_is_authoritative_when_declared(self):
        adapter = OpenAICompatibleAdapter()
        with self.assertRaises(ProviderException) as ctx:
            adapter.require_provider_capability(
                _provider("openai_compatible", capabilities={"TEXT"}),
                Capability.VISION,
            )
        self.assertEqual(ProviderErrorCode.PROVIDER_UNSUPPORTED_CAPABILITY, ctx.exception.code)

        adapter.require_provider_capability(
            _provider("openai_compatible", capabilities={"VISION"}),
            Capability.VISION,
        )
        adapter.require_provider_capability(
            _provider("openai_compatible"),
            Capability.VISION,
        )


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
        prompt = next(p for p in content if p.get("type") == "text")["text"].lower()
        self.assertIn("complete supplied audio through the end", prompt)
        self.assertIn("music", prompt)
        self.assertIn("ending theme", prompt)
        self.assertIn("credits", prompt)
        self.assertIn("speech resumes later", prompt)
        self.assertIn("do not fabricate speech", prompt)

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
                sent.update(k.get("json") or {})
                return _StreamResponse()

        sent: dict = {}
        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            result = await DashScopeNativeAdapter().synthesize(
                _provider("dashscope_native", "qwen-omni-turbo"),
                "Xin chao",
                "Serena",
            )

        # Omni models answer a bare <speak> block conversationally; the
        # read-aloud instruction must be in the user turn itself.
        user_turn = sent["messages"][-1]["content"]
        self.assertIn("word for word", user_turn)
        self.assertTrue(user_turn.endswith("<speak>Xin chao</speak>"))

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

    async def _run_transcribe(self, payload_text, terminal_line="data: [DONE]"):
        """Shared harness: stream one transcript JSON payload through transcribe."""
        lines = [f'data: {json.dumps({"choices": [{"delta": {"content": payload_text}}]})}']
        if terminal_line is not None:
            lines.append(terminal_line)

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
        return a successful empty TranscribeResult, never the misleading
        "requires detected_lang and non-empty timed segments" malformed error."""
        result = await self._run_transcribe(json.dumps({
            "detected_lang": "en",
            "segments": [],
        }))
        self.assertEqual([], result.segments)
        self.assertEqual("en", result.detected_lang)
        self.assertEqual(0.0, result.audio_seconds)

    async def test_transcribe_missing_detected_lang_still_malformed(self):
        """Missing detected_lang (invalid shape) stays PROVIDER_RESPONSE_MALFORMED."""
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(json.dumps({
                "segments": [{"text": "x", "start_ms": 0, "end_ms": 100}],
            }))
        self.assertEqual(
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)
        self.assertIn("requires detected_lang", str(ctx.exception))

    async def test_transcribe_raw_empty_response_remains_provider_empty(self):
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe("")
        self.assertEqual(
            ProviderErrorCode.PROVIDER_EMPTY_RESPONSE, ctx.exception.code)

    async def test_transcribe_segments_not_a_list_still_malformed(self):
        """segments as a non-list (invalid shape) stays PROVIDER_RESPONSE_MALFORMED."""
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(json.dumps({
                "detected_lang": "en",
                "segments": "no-speech",
            }))
        self.assertEqual(
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)

    async def test_transcribe_wrong_shape_reports_received_keys(self):
        """A wrong-shape transcript reports the received keys and length so a
        misconfigured STT model (e.g. text-only) is diagnosable from the error."""
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(json.dumps({
                "detected_lang": "en",
                "transcript": "hello world",
            }))
        self.assertEqual(
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)
        self.assertIn("requires detected_lang", str(ctx.exception))
        self.assertIn("detected_lang", str(ctx.exception))
        self.assertIn("transcript", str(ctx.exception))
        self.assertIn("response_len=", str(ctx.exception))

    async def test_transcribe_non_json_reports_response_len(self):
        """Prose output (no JSON at all) reports the response length."""
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe("Sorry, I cannot process audio.")
        self.assertEqual(
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)
        self.assertIn("timed JSON transcript", str(ctx.exception))
        self.assertIn("response_len=", str(ctx.exception))

    async def test_decode_bare_segment_array_uses_source_lang(self):
        """qwen-omni variants may return a bare top-level segment array
        (observed live: fenced ```json [...] without the envelope)."""
        from app.schemas.contract import ProviderPayload

        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "qwen3.5-omni-flash")
        text = "```json\n" + json.dumps([
            {"text": "hello world", "start_ms": 2506, "end_ms": 9314},
            {"text": "second line", "start_ms": 10075, "end_ms": 13425},
        ]) + "\n```"
        segments, detected = adapter._decode_timed_transcript(
            text, source_lang="vi", provider=provider)
        self.assertEqual("vi", detected)
        self.assertEqual(["hello world", "second line"], [s.text for s in segments])
        self.assertEqual([(2506, 9314), (10075, 13425)],
                         [(s.start_ms, s.end_ms) for s in segments])

    async def test_decode_normalizes_mid_transcript_seconds_drift(self):
        """Omni drifts from ms to seconds mid-transcript; segments must not be dropped."""
        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "qwen3-omni-flash")
        text = json.dumps({"detected_lang": "zh", "segments": [
            {"text": "a", "start_ms": 22560, "end_ms": 23520},
            {"text": "b", "start_ms": 27200, "end_ms": 28960},
            {"text": "c", "start_ms": 36.4, "end_ms": 41.04},
            {"text": "d", "start_ms": 44, "end_ms": 47},
        ]})
        segments, _ = adapter._decode_timed_transcript(text, source_lang="zh", provider=provider)
        self.assertEqual([(22560, 23520), (27200, 28960), (36400, 41040), (44000, 47000)],
                         [(s.start_ms, s.end_ms) for s in segments])

    async def test_decode_accepts_float_seconds_transcript(self):
        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "qwen3-omni-flash")
        text = json.dumps([{"text": "a", "start_ms": 0.0, "end_ms": 4.32},
                           {"text": "b", "start_ms": 5.84, "end_ms": 8.8}])
        segments, _ = adapter._decode_timed_transcript(text, source_lang="zh", provider=provider)
        self.assertEqual([(0, 4320), (5840, 8800)], [(s.start_ms, s.end_ms) for s in segments])

    async def test_decode_keeps_integer_milliseconds(self):
        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "qwen3-omni-flash")
        text = json.dumps([{"text": "a", "start_ms": 0, "end_ms": 900},
                           {"text": "b", "start_ms": 1000, "end_ms": 1800}])
        segments, _ = adapter._decode_timed_transcript(text, source_lang="vi", provider=provider)
        self.assertEqual([(0, 900), (1000, 1800)], [(s.start_ms, s.end_ms) for s in segments])

    async def test_decode_truncated_array_rejects_recoverable_prefix(self):
        """Complete objects inside truncated JSON are diagnostic-only."""
        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "qwen3.5-omni-flash")
        text = (
            '[{"text": "first", "start_ms": 0, "end_ms": 1250}, '
            '{"text": "second", "start_ms": 1300, "end_ms": 2600}, '
            '{"text": "cut off", "start_ms": 2700'
        )
        with self.assertRaises(ProviderValidation) as ctx:
            adapter._decode_timed_transcript(
                text, source_lang="vi", provider=provider)
        self.assertEqual(ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)
        self.assertTrue(ctx.exception.retryable)
        self.assertIn("partial_segments_detected=2", str(ctx.exception))

    async def test_transcribe_clean_eof_without_terminal_is_retryable_malformed(self):
        payload = json.dumps({
            "detected_lang": "en",
            "segments": [{"text": "partial", "start_ms": 0, "end_ms": 1_000}],
        })
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(payload, terminal_line=None)
        self.assertEqual(ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)
        self.assertTrue(ctx.exception.retryable)
        self.assertIn("terminal_seen=False", str(ctx.exception))

    async def test_transcribe_finish_reason_length_is_retryable_malformed(self):
        payload = json.dumps({
            "detected_lang": "en",
            "segments": [{"text": "partial", "start_ms": 0, "end_ms": 1_000}],
        })
        terminal = "data: " + json.dumps({
            "choices": [{"delta": {}, "finish_reason": "length"}],
        })
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(payload, terminal_line=terminal)
        self.assertEqual(ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)
        self.assertIn("finish_reason=length", str(ctx.exception))

    async def test_transcribe_finish_reason_stop_is_successful_terminal(self):
        payload = json.dumps({
            "detected_lang": "en",
            "segments": [{"text": "complete", "start_ms": 0, "end_ms": 1_000}],
        })
        terminal = "data: " + json.dumps({
            "choices": [{"delta": {}, "finish_reason": "stop"}],
        })
        result = await self._run_transcribe(payload, terminal_line=terminal)
        self.assertEqual("complete", result.segments[0].text)

    async def test_transcribe_production_shape_partial_prefix_without_terminal_fails(self):
        segments = [
            {"text": f"segment {index}", "start_ms": index * 6_000,
             "end_ms": min(170_000, (index + 1) * 6_000)}
            for index in range(28)
        ]
        payload = json.dumps({"detected_lang": "en", "segments": segments})
        with self.assertRaises(ProviderValidation) as ctx:
            await self._run_transcribe(payload, terminal_line=None)
        self.assertEqual(ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)
        self.assertIn("last_segment_end_ms=168000", str(ctx.exception))

    async def test_decode_bare_array_without_lang_still_malformed(self):
        """A bare array with no source_lang and no envelope lang cannot supply
        detected_lang — still malformed, never guessed."""
        from app.services.provider_errors import ProviderValidation as PV

        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "qwen3.5-omni-flash")
        with self.assertRaises(PV) as ctx:
            adapter._decode_timed_transcript(
                json.dumps([{"text": "x", "start_ms": 0, "end_ms": 100}]),
                source_lang=None, provider=provider)
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

    async def test_synthesize_falls_back_when_model_rejects_voice(self):
        """A voice saved for another Omni snapshot must not fail the TTS stage."""
        from app.services.protocol import dashscope_native as module

        audio = base64.b64encode(b"AAA").decode()
        ok_lines = [
            f'data: {json.dumps({"choices": [{"delta": {"audio": {"data": audio, "transcript": "Xin chao"}}}]})}',
            "data: [DONE]",
        ]
        rejected = json.dumps({"error": {
            "message": "<400> InternalError.Algo.InvalidParameter: Voice 'Serena' is not supported.",
            "code": "invalid_parameter_error"}}).encode()
        voices: list[str] = []

        class _StreamResponse:
            request = httpx.Request("POST", "https://provider.test/v1/chat/completions")

            def __init__(self, voice):
                self.status_code = 400 if voice == "Serena" else 200

            async def aiter_lines(self):
                for line in ok_lines:
                    yield line

            async def aread(self):
                return rejected

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
                voice = k["json"]["audio"]["voice"]
                voices.append(voice)
                return _StreamResponse(voice)

        module._VOICE_SUBSTITUTES.clear()
        provider = _provider("dashscope_native", "qwen3-omni-flash-2025-09-15")
        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            first = await DashScopeNativeAdapter().synthesize(provider, "Xin chao", "Serena")
            second = await DashScopeNativeAdapter().synthesize(provider, "Xin chao", "Serena")

        self.assertEqual("Serena", voices[0])
        substitute = voices[1]
        self.assertNotEqual("Serena", substitute)
        self.assertEqual(substitute, first.metadata["voice"])
        # The working substitute is remembered: no second rejected round-trip.
        self.assertEqual([substitute], voices[2:])
        self.assertEqual(substitute, second.metadata["voice"])
        module._VOICE_SUBSTITUTES.clear()

    async def test_synthesize_rejects_text_only_model_before_request(self):
        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient") as client_cls:
            with self.assertRaises(ProviderValidation) as ctx:
                await DashScopeNativeAdapter().synthesize(
                    _provider("dashscope_native", "qwen-plus"),
                    "Xin chao",
                    "Serena",
                )
        client_cls.assert_not_called()
        self.assertEqual(ProviderErrorCode.PROVIDER_UNSUPPORTED_MODEL, ctx.exception.code)
        self.assertIn("qwen-plus", str(ctx.exception))

    def test_voice_catalog_matches_versioned_omni_flash(self):
        from app.services.protocol.static_voices import (
            DASHSCOPE_FLASH_VOICES,
            DASHSCOPE_QWEN35_VOICES,
            DASHSCOPE_TURBO_VOICES,
            voices_for_dashscope_model,
        )

        self.assertEqual(DASHSCOPE_FLASH_VOICES, voices_for_dashscope_model("qwen3.8-omni-flash"))
        self.assertEqual(DASHSCOPE_FLASH_VOICES, voices_for_dashscope_model("qwen3-omni-flash"))
        self.assertEqual(DASHSCOPE_QWEN35_VOICES, voices_for_dashscope_model("qwen3.5-omni-flash"))
        self.assertEqual(DASHSCOPE_TURBO_VOICES, voices_for_dashscope_model("qwen-omni-turbo"))

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

    async def test_deepseek_dashscope_reasoning_control_and_fallback(self):
        captured: dict = {}
        payload = {
            "choices": [{"message": {
                "content": "",
                "reasoning_content": '{"translation":"Xin chao","applied_glossary":[]}',
            }}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2},
        }

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                captured.update(kwargs)
                return httpx.Response(200, json=payload)

        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "deepseek-v4.1-flash")
        extra = adapter.text_reasoning_extra(provider, disabled=True)
        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            result = await adapter.chat(
                provider,
                system="sys",
                user="translate",
                extra_body=extra,
            )

        self.assertEqual(False, captured["json"]["enable_thinking"])
        self.assertNotIn("thinking", captured["json"])
        self.assertEqual(payload["choices"][0]["message"]["reasoning_content"], result.text)

    async def test_qwen_plus_accepts_dashscope_reasoning_control_without_retry(self):
        calls: list[dict] = []

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                calls.append(kwargs["json"])
                return httpx.Response(200, json={
                    "choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}],
                })

        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "qwen-plus")
        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            result = await adapter.chat(
                provider,
                system="sys",
                user="hi",
                extra_body=adapter.text_reasoning_extra(provider, disabled=True),
            )

        self.assertEqual("OK", result.text)
        self.assertEqual(1, len(calls))
        self.assertEqual(False, calls[0]["enable_thinking"])

    async def test_qwen_omni_retries_once_without_unsupported_reasoning_control(self):
        calls: list[dict] = []

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                calls.append(kwargs["json"])
                if len(calls) == 1:
                    return httpx.Response(400, json={
                        "code": "InvalidParameter",
                        "message": "qwen-omni-turbo does not support enable_thinking",
                    })
                return httpx.Response(200, json={
                    "choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}],
                })

        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "qwen-omni-turbo")
        with patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()):
            result = await adapter.chat(
                provider,
                system="sys",
                user="hi",
                extra_body=adapter.text_reasoning_extra(provider, disabled=True),
            )

        self.assertEqual("OK", result.text)
        self.assertEqual(2, len(calls))
        self.assertEqual(False, calls[0]["enable_thinking"])
        self.assertNotIn("enable_thinking", calls[1])

    async def test_dashscope_arbitrary_bad_request_does_not_retry_without_control(self):
        calls: list[dict] = []

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                calls.append(kwargs["json"])
                return httpx.Response(400, json={
                    "code": "InvalidParameter",
                    "message": "messages must not be empty",
                })

        adapter = DashScopeNativeAdapter()
        provider = _provider("dashscope_native", "qwen-omni-turbo")
        with (
            patch("app.services.protocol.dashscope_native.httpx.AsyncClient", return_value=_Client()),
            self.assertRaises(ProviderException),
        ):
            await adapter.chat(
                provider,
                system="sys",
                user="hi",
                extra_body=adapter.text_reasoning_extra(provider, disabled=True),
            )

        self.assertEqual(1, len(calls))

    def test_dashscope_text_extraction_prefers_content_and_preserves_empty(self):
        adapter = DashScopeNativeAdapter()
        self.assertEqual(
            "answer",
            adapter._extract_text({"choices": [{"message": {
                "content": "answer", "reasoning_content": "reasoning",
            }}]}),
        )
        self.assertEqual(
            "native reasoning",
            adapter._extract_text({"output": {"text": "", "choices": [{"message": {
                "content": "", "reasoning_content": "native reasoning",
            }}]}}),
        )
        self.assertEqual(
            "",
            adapter._extract_text({"choices": [{"message": {
                "content": "", "reasoning_content": "",
            }}]}),
        )


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


class OpenAIThinkingCompatibilityTest(unittest.IsolatedAsyncioTestCase):
    def _client_for_responses(self, responses: list[httpx.Response]):
        calls: list[dict] = []

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                calls.append(kwargs["json"])
                return responses[len(calls) - 1]

        return _Client(), calls

    @staticmethod
    def _ok_response(text: str = "OK") -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": text}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    async def test_supported_thinking_control_uses_one_call(self):
        adapter = OpenAICompatibleAdapter()
        provider = _provider("openai_compatible", "supported-model")
        client, calls = self._client_for_responses([self._ok_response()])

        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await adapter.chat(
                provider,
                system="sys",
                user="hi",
                extra_body=adapter.text_reasoning_extra(provider, disabled=True),
            )

        self.assertEqual("OK", result.text)
        self.assertEqual(1, len(calls))
        self.assertEqual({"type": "disabled"}, calls[0]["thinking"])

    async def test_unsupported_thinking_retries_once_preserving_request_fields(self):
        adapter = OpenAICompatibleAdapter()
        provider = _provider("openai_compatible", "fallback-model")
        client, calls = self._client_for_responses([
            httpx.Response(400, text="unknown parameter: thinking"),
            self._ok_response(),
        ])

        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await adapter.chat(
                provider,
                system="sys",
                user="hi",
                max_tokens=4096,
                extra_body=adapter.text_reasoning_extra(provider, disabled=True),
            )

        self.assertEqual("OK", result.text)
        self.assertEqual(2, len(calls))
        self.assertEqual({"type": "disabled"}, calls[0]["thinking"])
        self.assertNotIn("thinking", calls[1])
        for field in ("model", "temperature", "max_tokens", "messages"):
            self.assertEqual(calls[0][field], calls[1][field])

    async def test_thinking_fallback_preserves_response_format(self):
        adapter = OpenAICompatibleAdapter()
        provider = _provider("openai_compatible", "json-model")
        client, calls = self._client_for_responses([
            httpx.Response(400, text="unsupported parameter: thinking"),
            self._ok_response('{"ok":true}'),
        ])

        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            await adapter.chat(
                provider,
                system="sys",
                user="hi",
                response_format={"type": "json_object"},
                extra_body=adapter.text_reasoning_extra(provider, disabled=True),
            )

        self.assertEqual(2, len(calls))
        self.assertNotIn("thinking", calls[1])

        self.assertEqual({"type": "json_object"}, calls[1]["response_format"])

    async def test_unsupported_json_mode_retries_once_without_response_format(self):
        # Local / proxy OpenAI-compatible servers often lack JSON mode; the
        # gateways parse JSON from plain text, so the hint is safe to drop.
        adapter = OpenAICompatibleAdapter()
        provider = _provider("openai_compatible", "no-json-mode-model")
        client, calls = self._client_for_responses([
            httpx.Response(400, text="response_format is not supported by this model"),
            self._ok_response('{"ok":true}'),
        ])

        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await adapter.chat(
                provider,
                system="sys",
                user="hi",
                response_format={"type": "json_object"},
            )

        self.assertEqual('{"ok":true}', result.text)
        self.assertEqual(2, len(calls))
        self.assertNotIn("response_format", calls[1])
        self.assertEqual(calls[0]["messages"], calls[1]["messages"])

    async def test_arbitrary_400_does_not_retry(self):
        adapter = OpenAICompatibleAdapter()
        provider = _provider("openai_compatible", "bad-request-model")
        client, calls = self._client_for_responses([
            httpx.Response(400, json={"error": {"message": "messages must not be empty"}}),
        ])

        with (
            patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client),
            self.assertRaises(ProviderException),
        ):
            await adapter.chat(
                provider,
                system="sys",
                user="hi",
                extra_body=adapter.text_reasoning_extra(provider, disabled=True),
            )

        self.assertEqual(1, len(calls))

    async def test_thinking_error_without_unsupported_signal_does_not_retry(self):
        adapter = OpenAICompatibleAdapter()
        provider = _provider("openai_compatible", "configured-thinking-model")
        client, calls = self._client_for_responses([
            httpx.Response(400, text="thinking configuration requires type=enabled"),
        ])

        with (
            patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client),
            self.assertRaises(ProviderException),
        ):
            await adapter.chat(
                provider,
                system="sys",
                user="hi",
                extra_body=adapter.text_reasoning_extra(provider, disabled=True),
            )

        self.assertEqual(1, len(calls))

    async def test_non_disabled_thinking_configuration_is_not_stripped(self):
        adapter = OpenAICompatibleAdapter()
        provider = _provider("openai_compatible", "arbitrary-thinking-model")
        client, calls = self._client_for_responses([
            httpx.Response(400, text="unknown parameter: thinking"),
        ])

        with (
            patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client),
            self.assertRaises(ProviderException),
        ):
            await adapter.chat(
                provider,
                system="sys",
                user="hi",
                extra_body={"thinking": {"type": "enabled"}},
            )

        self.assertEqual(1, len(calls))
        self.assertEqual({"type": "enabled"}, calls[0]["thinking"])

    async def test_strict_proxy_error_retries_without_thinking(self):
        adapter = OpenAICompatibleAdapter()
        provider = _provider("openai_compatible", "strict-proxy-model")
        client, calls = self._client_for_responses([
            httpx.Response(400, text="thinking: Extra inputs are not permitted"),
            self._ok_response(),
        ])

        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await adapter.chat(
                provider,
                system="sys",
                user="hi",
                extra_body=adapter.text_reasoning_extra(provider, disabled=True),
            )

        self.assertEqual("OK", result.text)
        self.assertEqual(2, len(calls))
        self.assertNotIn("thinking", calls[1])


class OpenAIVisionCompatibilityTest(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _ok_response(text: str = "OK") -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": text}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    def _client_for_responses(self, responses: list[httpx.Response]):
        calls: list[dict] = []

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                calls.append(kwargs["json"])
                return responses[len(calls) - 1]

        return _Client(), calls

    async def test_vision_sends_real_image_url_content(self):
        client, calls = self._client_for_responses([self._ok_response("seen")])
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible", capabilities={"VISION"}),
                system="sys",
                user="describe",
                images=["data:image/png;base64,AAAA"],
            )

        self.assertEqual("seen", result.text)
        self.assertEqual(1, len(calls))
        content = calls[0]["messages"][1]["content"]
        self.assertEqual({"type": "text", "text": "describe"}, content[0])
        self.assertEqual("image_url", content[1]["type"])
        self.assertEqual("data:image/png;base64,AAAA", content[1]["image_url"]["url"])

    async def test_text_only_provider_is_rejected_before_vision_call(self):
        client, calls = self._client_for_responses([self._ok_response()])
        with (
            patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client),
            self.assertRaises(ProviderException) as ctx,
        ):
            await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible", capabilities={"TEXT"}),
                system="sys",
                user="describe",
                images=["data:image/png;base64,AAAA"],
            )

        self.assertEqual(ProviderErrorCode.PROVIDER_UNSUPPORTED_CAPABILITY, ctx.exception.code)
        self.assertEqual(0, len(calls))

    async def test_legacy_capabilities_none_keeps_vision_behavior(self):
        client, calls = self._client_for_responses([self._ok_response()])
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible"),
                system="sys",
                user="describe",
                images=["https://images.example/frame.jpg"],
            )
        self.assertEqual(1, len(calls))

    async def test_arbitrary_vision_400_does_not_retry(self):
        client, calls = self._client_for_responses([
            httpx.Response(400, text="image dimensions are too large"),
        ])
        with (
            patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client),
            self.assertRaises(ProviderException),
        ):
            await OpenAICompatibleAdapter().chat(
                _provider("openai_compatible", capabilities={"VISION"}),
                system="sys",
                user="describe",
                response_format={"type": "json_object"},
                images=["data:image/png;base64,AAAA"],
            )
        self.assertEqual(1, len(calls))


class OpenAISttCompatibilityTest(unittest.IsolatedAsyncioTestCase):
    def _client_for_responses(self, responses: list[httpx.Response]):
        calls: list[dict] = []

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                calls.append({"url": url, **kwargs})
                return responses[len(calls) - 1]

        return _Client(), calls

    @staticmethod
    def _provider():
        return _provider("openai_compatible", "stt-model", capabilities={"STT"})

    @staticmethod
    def _ok_response(segments):
        return httpx.Response(200, json={"duration": 3.0, "segments": segments})

    async def test_verbose_json_is_one_call_and_normalizes_seconds(self):
        client, calls = self._client_for_responses([
            self._ok_response([{"text": " hello ", "start": 1.25, "end": 2.5}]),
        ])
        audio = AudioInput.from_bytes(b"wav-bytes", filename="clip.wav", mime_type="audio/wav")
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().transcribe(
                self._provider(), audio, source_lang="vi",
            )
        self.assertEqual(1, len(calls))
        self.assertEqual("/audio/transcriptions", calls[0]["url"].rsplit("/v1", 1)[-1])
        self.assertEqual("verbose_json", calls[0]["data"]["response_format"])
        self.assertEqual("stt-model", calls[0]["data"]["model"])
        self.assertEqual("vi", calls[0]["data"]["language"])
        self.assertEqual([("hello", 1250, 2500)], [
            (s.text, s.start_ms, s.end_ms) for s in result.segments
        ])

    async def test_millisecond_segments_are_preserved(self):
        client, _ = self._client_for_responses([
            self._ok_response([{"text": "hello", "start_ms": 1250, "end_ms": 2500}]),
        ])
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().transcribe(
                self._provider(), AudioInput.from_bytes(b"wav"),
            )
        self.assertEqual((1250, 2500), (result.segments[0].start_ms, result.segments[0].end_ms))

    async def test_unsupported_response_format_retries_once_with_same_multipart_fields(self):
        client, calls = self._client_for_responses([
            httpx.Response(400, text="unknown response_format field"),
            self._ok_response([{"text": "hello", "start": 0, "end": 1}]),
        ])
        audio = AudioInput.from_bytes(b"same-audio", filename="clip.mp3", mime_type="audio/mpeg")
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            await OpenAICompatibleAdapter().transcribe(self._provider(), audio, source_lang="en")
        self.assertEqual(2, len(calls))
        self.assertIn("response_format", calls[0]["data"])
        self.assertNotIn("response_format", calls[1]["data"])
        self.assertEqual(calls[0]["data"]["model"], calls[1]["data"]["model"])
        self.assertEqual(calls[0]["data"]["language"], calls[1]["data"]["language"])
        self.assertEqual(calls[0]["files"]["file"][0], calls[1]["files"]["file"][0])
        self.assertEqual(calls[0]["files"]["file"][1].read(), calls[1]["files"]["file"][1].read())

    async def test_arbitrary_stt_400_does_not_retry(self):
        client, calls = self._client_for_responses([
            httpx.Response(400, text="audio is too long"),
        ])
        with (
            patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client),
            self.assertRaises(ProviderException),
        ):
            await OpenAICompatibleAdapter().transcribe(self._provider(), AudioInput.from_bytes(b"wav"))
        self.assertEqual(1, len(calls))

    async def test_missing_timestamps_is_structured_malformed_response(self):
        client, _ = self._client_for_responses([
            self._ok_response([{"text": "hello"}]),
        ])
        with (
            patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client),
            self.assertRaises(ProviderException) as ctx,
        ):
            await OpenAICompatibleAdapter().transcribe(self._provider(), AudioInput.from_bytes(b"wav"))
        self.assertEqual(ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)


class OpenAITtsCompatibilityTest(unittest.IsolatedAsyncioTestCase):
    def _client_for_responses(self, responses: list[httpx.Response]):
        calls: list[dict] = []

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, **kwargs):
                calls.append({"url": url, **kwargs})
                return responses[len(calls) - 1]

        return _Client(), calls

    @staticmethod
    def _provider():
        return _provider("openai_compatible", "tts-model", capabilities={"TTS"})

    @staticmethod
    def _audio_response(content=b"mp3"):
        return httpx.Response(200, content=content, headers={"content-type": "audio/mpeg"})

    async def test_speech_endpoint_is_one_call_and_preserves_voice(self):
        client, calls = self._client_for_responses([self._audio_response()])
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().synthesize(self._provider(), "hello", "nova")
        self.assertEqual(b"mp3", result.audio_bytes)
        self.assertEqual(1, len(calls))
        self.assertTrue(calls[0]["url"].endswith("/audio/speech"))
        self.assertEqual("tts-model", calls[0]["json"]["model"])
        self.assertEqual("hello", calls[0]["json"]["input"])
        self.assertEqual("nova", calls[0]["json"]["voice"])

    async def _synthesize_with(self, content: bytes, content_type: str):
        response = httpx.Response(200, content=content, headers={"content-type": content_type})
        client, _ = self._client_for_responses([response])
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            return await OpenAICompatibleAdapter().synthesize(self._provider(), "hello", "nova")

    _WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 28

    async def test_proxy_wav_is_passed_through_as_wav(self):
        result = await self._synthesize_with(self._WAV, "audio/wav")
        self.assertEqual(self._WAV, result.audio_bytes)
        self.assertEqual("audio/wav", result.mime_type)
        self.assertEqual("wav", result.metadata["format"])

    async def test_wav_body_mislabeled_as_mpeg_is_sniffed_as_wav(self):
        result = await self._synthesize_with(self._WAV, "audio/mpeg")
        self.assertEqual("audio/wav", result.mime_type)

    async def test_raw_pcm_is_wrapped_as_wav_with_declared_rate(self):
        pcm = b"\x01\x00\x02\x00\x03\x00"
        result = await self._synthesize_with(pcm, "audio/L16; rate=16000; channels=1")
        self.assertEqual("audio/wav", result.mime_type)
        self.assertEqual(16000, result.sample_rate)
        self.assertEqual(b"RIFF", result.audio_bytes[:4])
        self.assertEqual(b"WAVE", result.audio_bytes[8:12])
        self.assertEqual(16000, int.from_bytes(result.audio_bytes[24:28], "little"))
        self.assertEqual(pcm, result.audio_bytes[44:])

    async def test_raw_pcm_without_rate_defaults_to_24k(self):
        result = await self._synthesize_with(b"\x00\x00" * 4, "audio/pcm")
        self.assertEqual(24000, int.from_bytes(result.audio_bytes[24:28], "little"))

    async def test_ogg_is_passed_through(self):
        result = await self._synthesize_with(b"OggS" + b"\x00" * 20, "audio/ogg")
        self.assertEqual("audio/ogg", result.mime_type)

    async def test_unknown_bytes_with_generic_header_keep_mp3(self):
        result = await self._synthesize_with(b"mp3", "application/octet-stream")
        self.assertEqual("audio/mpeg", result.mime_type)

    async def test_undecodable_audio_type_fails_closed(self):
        with self.assertRaises(ProviderException) as ctx:
            await self._synthesize_with(b"\x00\x01", "audio/basic")
        self.assertEqual(ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED, ctx.exception.code)

    async def test_unsupported_speech_response_format_retries_once_without_only_that_field(self):
        client, calls = self._client_for_responses([
            httpx.Response(400, text="response_format is not supported"),
            self._audio_response(b"fallback-mp3"),
        ])
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().synthesize(self._provider(), "hello", "nova")
        self.assertEqual(b"fallback-mp3", result.audio_bytes)
        self.assertEqual(2, len(calls))
        self.assertIn("response_format", calls[0]["json"])
        self.assertNotIn("response_format", calls[1]["json"])
        self.assertEqual("nova", calls[1]["json"]["voice"])
        self.assertEqual("tts-model", calls[1]["json"]["model"])
        self.assertEqual("hello", calls[1]["json"]["input"])

    async def test_arbitrary_speech_400_does_not_retry(self):
        client, calls = self._client_for_responses([
            httpx.Response(400, text="voice is invalid"),
        ])
        with (
            patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client),
            self.assertRaises(ProviderException),
        ):
            await OpenAICompatibleAdapter().synthesize(self._provider(), "hello", "nova")
        self.assertEqual(1, len(calls))

    async def test_non_mp3_fallback_response_keeps_its_container(self):
        client, _ = self._client_for_responses([
            httpx.Response(400, text="response_format unsupported"),
            httpx.Response(200, content=self._WAV, headers={"content-type": "audio/wav"}),
        ])
        with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=client):
            result = await OpenAICompatibleAdapter().synthesize(self._provider(), "hello", "nova")
        self.assertEqual("audio/wav", result.mime_type)


if __name__ == "__main__":
    unittest.main()
