"""STT on speech-vendor keys that also serve TTS: Azure Fast Transcription and
ElevenLabs Scribe — host mapping, request shape, per-capability model fallback
and transcript parsing."""
from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import httpx

from app.schemas.contract import ProviderPayload
from app.services.protocol import AudioInput
from app.services.protocol.azure_tts import AzureSpeechAdapter, parse_fast_transcription, stt_base_url
from app.services.protocol.elevenlabs_native import (
    ElevenLabsNativeAdapter,
    parse_scribe_transcript,
    stt_model,
    tts_model,
)
from app.services.protocol.speech_stt import TimedWord, detected_language, locale_for, segments_from_words
from app.services.provider_errors import ProviderException


class _RecordingClient:
    """AsyncClient stand-in: returns one queued response and records the POST."""

    def __init__(self, response: httpx.Response) -> None:
        self.response = response
        self.calls: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self.response


def _audio() -> AudioInput:
    return AudioInput.from_bytes(b"RIFF....WAVE", filename="a.wav", mime_type="audio/wav")


def _azure(base_url: str = "https://southeastasia.tts.speech.microsoft.com") -> ProviderPayload:
    return ProviderPayload(protocol="azure_speech", base_url=base_url, api_key="k", model="azure-fast-transcription",
                           capabilities=["STT"])


def _eleven(model: str) -> ProviderPayload:
    return ProviderPayload(protocol="elevenlabs_native", base_url="https://api.elevenlabs.io/v1", api_key="k",
                           model=model, capabilities=["STT"])


class SpeechSttHelpersTest(unittest.TestCase):
    def test_locale_for_pinned_and_auto(self):
        self.assertEqual("vi-VN", locale_for("vi"))
        self.assertEqual("en-GB", locale_for("en-gb"))
        self.assertIsNone(locale_for("auto"))
        self.assertIsNone(locale_for(None))
        self.assertIsNone(locale_for("xx"))

    def test_detected_language_maps_iso639_3(self):
        self.assertEqual("vi", detected_language("vie"))
        self.assertEqual("en", detected_language("en-US"))
        self.assertIsNone(detected_language(None))

    def test_words_group_on_punctuation_and_pause(self):
        words = [TimedWord("Hi", 0, 200), TimedWord("there.", 200, 500),
                 TimedWord("After", 600, 800), TimedWord("pause", 2000, 2300)]
        segments = segments_from_words(words)
        self.assertEqual(["Hi there.", "After", "pause"], [s.text for s in segments])
        self.assertEqual((0, 500), (segments[0].start_ms, segments[0].end_ms))


class AzureSttTest(unittest.IsolatedAsyncioTestCase):
    def test_stt_host_mapping(self):
        self.assertEqual("https://eastus.api.cognitive.microsoft.com",
                         stt_base_url("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"))
        self.assertEqual("https://eastus.api.cognitive.microsoft.com",
                         stt_base_url("https://eastus.api.cognitive.microsoft.com/"))
        self.assertEqual("https://res.cognitiveservices.azure.com",
                         stt_base_url("https://res.cognitiveservices.azure.com"))

    async def _transcribe(self, source_lang, body=None):
        response = httpx.Response(200, json=body or {"durationMilliseconds": 3000, "phrases": []},
                                  request=httpx.Request("POST", "https://x"))
        client = _RecordingClient(response)
        with patch("app.services.protocol.azure_tts.httpx.AsyncClient", return_value=client):
            result = await AzureSpeechAdapter().transcribe(_azure(), _audio(), source_lang=source_lang)
        return result, client.calls[0]

    async def test_request_goes_to_stt_host_with_pinned_locale(self):
        _, call = await self._transcribe("vi")
        self.assertEqual("https://southeastasia.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe",
                         call["url"])
        self.assertIn("api-version", call["params"])
        self.assertEqual({"Ocp-Apim-Subscription-Key": "k"}, call["headers"])
        self.assertEqual({"locales": ["vi-VN"]}, json.loads(call["files"]["definition"][1]))

    async def test_auto_language_sends_candidate_locales(self):
        _, call = await self._transcribe("auto")
        locales = json.loads(call["files"]["definition"][1])["locales"]
        self.assertIn("vi-VN", locales)
        self.assertGreater(len(locales), 1)

    async def test_phrases_become_segments(self):
        result, _ = await self._transcribe("auto", {
            "durationMilliseconds": 5000,
            "phrases": [
                {"offsetMilliseconds": 2000, "durationMilliseconds": 800, "text": "Second.", "locale": "vi-VN"},
                {"offsetMilliseconds": 100, "durationMilliseconds": 900, "text": "First one.", "locale": "vi-VN",
                 "confidence": 0.9},
            ],
        })
        self.assertEqual(["First one.", "Second."], [s.text for s in result.segments])
        self.assertEqual((100, 1000), (result.segments[0].start_ms, result.segments[0].end_ms))
        self.assertEqual("vi", result.detected_lang)
        self.assertEqual(5.0, result.audio_seconds)

    async def test_no_language_identified_means_no_speech(self):
        # Azure's auto language detection answers 422 on audio without speech (e.g. the probe tone).
        response = httpx.Response(422, json={"code": "UnprocessableEntity", "message": "No language was identified.",
                                             "innerError": {"code": "NoLanguageIdentified"}},
                                  request=httpx.Request("POST", "https://x"))
        with patch("app.services.protocol.azure_tts.httpx.AsyncClient", return_value=_RecordingClient(response)):
            result = await AzureSpeechAdapter().transcribe(_azure(), _audio(), source_lang="auto")
        self.assertEqual([], result.segments)

    async def test_other_422_is_still_an_error(self):
        response = httpx.Response(422, json={"code": "UnprocessableEntity", "innerError": {"code": "InvalidLocale"}},
                                  request=httpx.Request("POST", "https://x"))
        with patch("app.services.protocol.azure_tts.httpx.AsyncClient", return_value=_RecordingClient(response)):
            with self.assertRaises(ProviderException):
                await AzureSpeechAdapter().transcribe(_azure(), _audio(), source_lang="vi")

    def test_long_unpunctuated_phrase_is_cut_at_widest_word_gaps(self):
        def word(text, offset, duration):
            return {"text": text, "offsetMilliseconds": offset, "durationMilliseconds": duration}

        words = [word("One", 0, 400), word("two", 450, 400),            # 1.2 s gap below
                 word("three", 2050, 400), word("four", 2500, 400),     # 3 s gap below
                 word("five", 5900, 400), word("six", 6350, 400),
                 word("seven", 9000, 400), word("eight", 9450, 400)]
        result = parse_fast_transcription({"phrases": [{
            "offsetMilliseconds": 0, "durationMilliseconds": 9850, "locale": "en-US",
            "text": "One two three four five six seven eight", "words": words}]})
        self.assertTrue(all(s.end_ms - s.start_ms <= 7000 for s in result.segments))
        self.assertEqual(["One two three four", "five six seven eight"], [s.text for s in result.segments])

    def test_malformed_payload_is_rejected(self):
        with self.assertRaises(ProviderException):
            parse_fast_transcription({"phrases": "nope"})


class ElevenLabsSttTest(unittest.IsolatedAsyncioTestCase):
    def test_model_fallback_per_capability(self):
        self.assertEqual("scribe_v1", stt_model("eleven_multilingual_v2"))
        self.assertEqual("scribe_v2", stt_model("scribe_v2"))
        self.assertEqual("eleven_multilingual_v2", tts_model("scribe_v1"))
        self.assertEqual("eleven_flash_v2_5", tts_model("eleven_flash_v2_5"))

    async def test_request_shape(self):
        response = httpx.Response(200, json={"language_code": "vie", "words": []},
                                  request=httpx.Request("POST", "https://x"))
        client = _RecordingClient(response)
        with patch("app.services.protocol.elevenlabs_native.httpx.AsyncClient", return_value=client):
            result = await ElevenLabsNativeAdapter().transcribe(_eleven("eleven_multilingual_v2"), _audio(),
                                                                source_lang="vi")
        call = client.calls[0]
        self.assertEqual("https://api.elevenlabs.io/v1/speech-to-text", call["url"])
        self.assertEqual("scribe_v1", call["data"]["model_id"])
        self.assertEqual("vi", call["data"]["language_code"])
        self.assertIn("file", call["files"])
        self.assertEqual("vi", result.detected_lang)

    def test_spacing_and_events_are_skipped(self):
        result = parse_scribe_transcript({"language_code": "eng", "words": [
            {"text": "Hello", "type": "word", "start": 0.0, "end": 0.3},
            {"text": " ", "type": "spacing", "start": 0.3, "end": 0.35},
            {"text": "(laughs)", "type": "audio_event", "start": 0.35, "end": 0.8},
            {"text": "world!", "type": "word", "start": 0.8, "end": 1.1},
        ]})
        self.assertEqual(["Hello world!"], [s.text for s in result.segments])
        self.assertEqual("en", result.detected_lang)


if __name__ == "__main__":
    unittest.main()
