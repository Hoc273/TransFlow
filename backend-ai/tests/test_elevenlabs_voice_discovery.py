"""ElevenLabs voice discovery — BCP-47 normalization, multi-language
compatibility metadata, and pagination regression tests."""
from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from app.schemas.contract import ProviderPayload
from app.services.protocol.elevenlabs_native import ElevenLabsNativeAdapter
from app.services.protocol.language_codes import normalize_language


def _provider() -> ProviderPayload:
    return ProviderPayload(
        protocol="elevenlabs_native",
        base_url="https://provider.test/v1",
        api_key="sk-test",
        model="eleven_multilingual_v2",
    )


def _page(voices: list[dict], has_more: bool = False, token: str | None = None) -> dict:
    return {"voices": voices, "has_more": has_more, "next_page_token": token}


class _PaginatedClient:
    """Serves queued JSON pages one per GET /voices call and records requests."""

    def __init__(self, pages: list[dict]) -> None:
        self.pages = [httpx.Response(200, json=page) for page in pages]
        self.calls: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self.pages.pop(0)


class NormalizeLanguageTest(unittest.TestCase):
    def test_bcp47_variants_collapse_to_primary_code(self):
        self.assertEqual("vi", normalize_language("vi-VN"))
        self.assertEqual("en", normalize_language("en-US"))
        self.assertEqual("en", normalize_language("en-GB"))
        self.assertEqual("vi", normalize_language("VI"))
        self.assertEqual("ja", normalize_language("ja_JP"))

    def test_unusable_values_are_not_guessed(self):
        self.assertIsNone(normalize_language(None))
        self.assertIsNone(normalize_language(""))
        self.assertIsNone(normalize_language("   "))
        # Human-readable words are NOT resolved here — only the ElevenLabs
        # adapter owns that alias table.
        self.assertIsNone(normalize_language("english"))
        self.assertIsNone(normalize_language("123"))


class ElevenLabsDiscoveryLanguageMetadataTest(unittest.IsolatedAsyncioTestCase):
    async def _discover(self, pages: list[dict]):
        client = _PaginatedClient(pages)
        with patch(
            "app.services.protocol.elevenlabs_native.httpx.AsyncClient",
            return_value=client,
        ):
            result = await ElevenLabsNativeAdapter().discover_voices(_provider())
        return result, client

    async def test_verified_languages_win_over_label(self):
        result, _ = await self._discover([
            _page([{
                "voice_id": "multi",
                "name": "Multi",
                "labels": {"language": "english", "gender": "female"},
                "verified_languages": [{"language_code": "vi"}, {"language_code": "en"}],
            }])
        ])
        self.assertEqual(["vi", "en"], result.voices[0].languages)
        self.assertEqual("vi", result.voices[0].language)

    async def test_multi_language_voice_keeps_every_code(self):
        result, _ = await self._discover([
            _page([{
                "voice_id": "polyglot",
                "name": "Polyglot",
                "verified_languages": [
                    {"language_code": "ja"}, {"language_code": "ko"},
                ],
            }])
        ])
        self.assertEqual(["ja", "ko"], result.voices[0].languages)
        self.assertEqual("ja", result.voices[0].language)

    async def test_v2_wire_shape_uses_language_key(self):
        result, _ = await self._discover([
            _page([{
                "voice_id": "v2shape",
                "name": "V2",
                "verified_languages": [{"language": "fr"}],
            }])
        ])
        self.assertEqual(["fr"], result.voices[0].languages)

    async def test_label_fallback_iso_and_alias_word(self):
        result, _ = await self._discover([
            _page([
                {"voice_id": "iso-label", "name": "Iso",
                 "labels": {"language": "ko"}},
                {"voice_id": "word-label", "name": "Word",
                 "labels": {"language": "vietnamese"}},
                {"voice_id": "word-en", "name": "WordEn",
                 "labels": {"language": "english"}},
            ])
        ])
        by_id = {voice.voice_id: voice for voice in result.voices}
        self.assertEqual(["ko"], by_id["iso-label"].languages)
        self.assertEqual(["vi"], by_id["word-label"].languages)
        self.assertEqual(["en"], by_id["word-en"].languages)

    async def test_unknown_language_is_und_never_compatible_by_default(self):
        result, _ = await self._discover([
            _page([{"voice_id": "mystery", "name": "Mystery"}])
        ])
        self.assertEqual("und", result.voices[0].language)
        self.assertEqual(["und"], result.voices[0].languages)

    async def test_pagination_follows_has_more_then_token(self):
        result, client = await self._discover([
            _page(
                [{"voice_id": "p1", "name": "P1"}],
                has_more=True,
                token="tok-2",
            ),
            _page([{"voice_id": "p2-vi", "name": "P2",
                    "labels": {"language": "vi-VN"}}]),
        ])
        ids = {voice.voice_id for voice in result.voices}
        self.assertEqual({"p1", "p2-vi"}, ids)
        self.assertEqual(2, len(client.calls))
        self.assertEqual(100, client.calls[0]["params"]["page_size"])
        self.assertNotIn("next_page_token", client.calls[0]["params"])
        self.assertEqual("tok-2", client.calls[1]["params"]["next_page_token"])

    async def test_single_page_legacy_response_without_pagination_fields(self):
        client = _PaginatedClient([{"voices": [
            {"voice_id": "legacy", "name": "Legacy",
             "labels": {"language": "en"}},
        ]}])
        with patch(
            "app.services.protocol.elevenlabs_native.httpx.AsyncClient",
            return_value=client,
        ):
            result = await ElevenLabsNativeAdapter().discover_voices(_provider())
        self.assertEqual(["legacy"], [voice.voice_id for voice in result.voices])
        self.assertEqual(1, len(client.calls))

    async def test_voice_without_voice_id_is_skipped(self):
        result, _ = await self._discover([
            _page([{"name": "NoId", "labels": {"language": "en"}}])
        ])
        self.assertEqual([], result.voices)


if __name__ == "__main__":
    unittest.main()
