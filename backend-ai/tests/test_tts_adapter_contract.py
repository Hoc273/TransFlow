"""Adapter Contract Test — every TTS adapter must satisfy (ADR-CEP Phase A1.2):

* extends ``BaseTtsAdapter`` and declares a non-empty wire protocol
* supports TTS (and only TTS)
* a non-empty, unique-id fallback catalog (STATIC discovery except Azure, which is AUTO)
* ``default_probe_voice`` is a member of its own catalog
* unknown voice_id fails fast with ``PROVIDER_TTS_VOICE_NOT_FOUND``
  before the vendor engine runs
* synthesized results carry ``execution_info`` metadata with provider/model/
  voice and never leak the API key (TC-SEC-01)
* static adapters' ``discover_voices`` returns mode STATIC with the full catalog
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

from app.schemas.contract import ProviderPayload
from app.services.protocol.azure_tts import AzureSpeechAdapter
from app.services.protocol.base_tts import BaseTtsAdapter
from app.services.protocol.google_tts import GoogleSpeechAdapter
from app.services.protocol.piper import PiperAdapter
from app.services.protocol.static_voices import PIPER_VOICE_MODELS
from app.services.protocol.types import (
    Capability,
    SynthesizeResult,
    VoiceDiscoveryStrategy,
)
from app.services.provider_errors import ProviderErrorCode, ProviderValidation

ADAPTER_CLASSES = (PiperAdapter, GoogleSpeechAdapter, AzureSpeechAdapter)
# Azure discovers its catalog live (voices/list); only these keep a STATIC one.
STATIC_ADAPTER_CLASSES = (PiperAdapter, GoogleSpeechAdapter)


def _provider(protocol: str) -> ProviderPayload:
    return ProviderPayload(
        protocol=protocol,  # type: ignore[arg-type]
        capabilities={"TTS"},
        base_url="http://provider.test/v1",
        api_key="sk-test",
        model="probe-model",
    )


class TtsAdapterContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_all_adapters_extend_base_tts_adapter(self):
        for cls in ADAPTER_CLASSES:
            with self.subTest(protocol=cls.protocol):
                self.assertTrue(issubclass(cls, BaseTtsAdapter))
                self.assertTrue(cls.protocol)

    async def test_supports_tts_only_with_static_discovery(self):
        for cls in ADAPTER_CLASSES:
            with self.subTest(protocol=cls.protocol):
                adapter = cls()
                self.assertTrue(adapter.supports(Capability.TTS))
                self.assertFalse(adapter.supports(Capability.STT))
                self.assertFalse(adapter.supports(Capability.TEXT))
                self.assertEqual(
                    VoiceDiscoveryStrategy.STATIC if cls in STATIC_ADAPTER_CLASSES
                    else VoiceDiscoveryStrategy.AUTO,
                    adapter.voice_discovery_strategy,
                )
                catalog = adapter.catalog()
                self.assertGreater(len(catalog), 0)
                ids = [voice.voice_id for voice in catalog]
                self.assertEqual(len(ids), len(set(ids)))
                self.assertTrue(all(voice.display_name for voice in catalog))

    async def test_default_probe_voice_is_in_own_catalog(self):
        for cls in ADAPTER_CLASSES:
            with self.subTest(protocol=cls.protocol):
                adapter = cls()
                self.assertIn(
                    adapter.default_probe_voice,
                    {voice.voice_id for voice in adapter.catalog()},
                )

    async def test_unknown_voice_fails_fast_before_engine(self):
        for cls in ADAPTER_CLASSES:
            with self.subTest(protocol=cls.protocol):
                adapter = cls()
                engine_calls: list[str] = []

                async def _engine(provider, text, voice_id):  # pragma: no cover
                    engine_calls.append(voice_id)
                    raise AssertionError("engine must not run for unknown voice")

                adapter._synthesize_engine = _engine  # type: ignore[method-assign]
                with self.assertRaises(ProviderValidation) as ctx:
                    await adapter.synthesize(
                        _provider(cls.protocol), "hello", "not-a-real-voice"
                    )
                self.assertEqual(
                    ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND,
                    ctx.exception.code,
                )
                self.assertEqual([], engine_calls)

    async def test_synthesize_attaches_execution_info_without_key(self):
        for cls in ADAPTER_CLASSES:
            with self.subTest(protocol=cls.protocol):
                adapter = cls()
                voice_id = adapter.catalog()[0].voice_id

                async def _engine(provider, text, voice_id):
                    return SynthesizeResult(
                        audio_bytes=b"audio",
                        mime_type="audio/mpeg",
                        metadata={"format": "mp3"},
                    )

                adapter._synthesize_engine = _engine  # type: ignore[method-assign]
                result = await adapter.synthesize(
                    _provider(cls.protocol), "hello", voice_id
                )
                info = result.metadata["execution_info"]
                self.assertEqual(cls.protocol, info["provider"])
                expected_model = (
                    PIPER_VOICE_MODELS[voice_id]
                    if cls.protocol == "local_piper"
                    else "probe-model"
                )
                self.assertEqual(expected_model, info["model"])
                self.assertEqual(voice_id, info["voice"])
                self.assertNotIn("sk-test", str(result.metadata))
                # Engine metadata is preserved alongside execution_info.
                self.assertEqual("mp3", result.metadata["format"])

    async def test_discover_voices_returns_static_mode(self):
        for cls in STATIC_ADAPTER_CLASSES:
            with self.subTest(protocol=cls.protocol):
                adapter = cls()
                if cls.protocol == "local_piper":
                    # Piper discovery = intersection with bundled models; simulate
                    # a full image so the whole catalog is advertised.
                    with patch(
                        "app.services.protocol.piper._bundled_model_stems",
                        return_value=set(PIPER_VOICE_MODELS.values()),
                    ):
                        discovery = await adapter.discover_voices(_provider(cls.protocol))
                else:
                    discovery = await adapter.discover_voices(_provider(cls.protocol))
                self.assertEqual("STATIC", discovery.mode)
                self.assertEqual(VoiceDiscoveryStrategy.STATIC, discovery.strategy)
                self.assertEqual(len(adapter.catalog()), len(discovery.voices))


if __name__ == "__main__":
    unittest.main()
