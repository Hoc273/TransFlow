from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from app.schemas.contract import ProviderPayload
from app.services.provider_errors import ProviderException
from app.services.tts_adapters import (
    ElevenLabsNativeTtsAdapter,
    OpenAICompatibleTtsAdapter,
    get_tts_adapter,
)


class _FakeClient:
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


def _provider(protocol: str, model: str) -> ProviderPayload:
    return ProviderPayload(
        protocol=protocol,  # type: ignore[arg-type]
        capabilities={"TTS", "TEXT"},
        base_url="http://provider.test/v1",
        api_key="sk-test",
        model=model,
    )


class TtsAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_openai_compatible_uses_custom_base_url_and_model(self):
        client = _FakeClient(httpx.Response(200, content=b"mp3"))
        with patch(
            "app.services.protocol.openai_compatible.httpx.AsyncClient",
            return_value=client,
        ):
            audio = await OpenAICompatibleTtsAdapter().synthesize(
                _provider("openai_compatible", "qwen3.5-omni-plus"),
                "Xin chao",
                "Cherry",
            )

        self.assertEqual(b"mp3", audio)
        method, url, kwargs = client.calls[0]
        self.assertEqual("POST", method)
        self.assertEqual("http://provider.test/v1/audio/speech", url)
        self.assertEqual("qwen3.5-omni-plus", kwargs["json"]["model"])
        self.assertEqual("Bearer sk-test", kwargs["headers"]["Authorization"])

    async def test_openai_compatible_falls_back_when_voice_endpoint_is_absent(self):
        client = _FakeClient(httpx.Response(404))
        with patch(
            "app.services.protocol.openai_compatible.httpx.AsyncClient",
            return_value=client,
        ):
            discovery = await OpenAICompatibleTtsAdapter().list_voices(
                _provider("openai_compatible", "local-model"),
            )

        self.assertEqual("FALLBACK", discovery.mode)
        self.assertEqual({"alloy", "echo", "nova", "onyx"}, {
            voice.voice_id for voice in discovery.voices
        })

    async def test_elevenlabs_uses_native_path_header_and_model(self):
        client = _FakeClient(httpx.Response(200, content=b"native-mp3"))
        with patch(
            "app.services.protocol.elevenlabs_native.httpx.AsyncClient",
            return_value=client,
        ):
            audio = await ElevenLabsNativeTtsAdapter().synthesize(
                _provider("elevenlabs_native", "eleven_multilingual_v2"),
                "Hello",
                "voice/id",
            )

        self.assertEqual(b"native-mp3", audio)
        method, url, kwargs = client.calls[0]
        self.assertEqual("POST", method)
        self.assertEqual(
            "http://provider.test/v1/text-to-speech/voice%2Fid",
            url,
        )
        self.assertEqual("sk-test", kwargs["headers"]["xi-api-key"])
        self.assertEqual(
            "eleven_multilingual_v2",
            kwargs["json"]["model_id"],
        )

    def test_placeholder_protocol_has_no_tts_adapter(self):
        with self.assertRaises(ProviderException):
            get_tts_adapter("anthropic")


if __name__ == "__main__":
    unittest.main()
