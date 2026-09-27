"""STT wrong-language guard + multipart filename (root cause 2026-09-26).

FreeLLMAPI ``auto`` STT: Groq Whisper rejected the upload because it was named
``tmpXXXX.audio`` (Groq validates by extension), the pool fell back to the
English-only ``whisper-tiny-en`` and Chinese audio came back as
"I'm very happy." × 60 — which passed the timing-only sanity check.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.contract import SttSegment
from app.services import stt_gateway
from app.services.transcript_sanity import TranscriptSanityResult, TranscriptSanityValidator


def _segs(*texts: str) -> list[SttSegment]:
    return [
        SttSegment(text=text, start_ms=i * 1000, end_ms=i * 1000 + 900)
        for i, text in enumerate(texts)
    ]


def test_english_hallucination_for_chinese_source_is_malformed():
    verdict = TranscriptSanityValidator.validate(_segs(*["I'm very happy."] * 20), 97_000, "zh")
    assert verdict.result is TranscriptSanityResult.MALFORMED
    assert "source language 'zh'" in verdict.violation.reason


def test_chinese_transcript_with_english_words_is_valid():
    verdict = TranscriptSanityValidator.validate(
        _segs("黑水有动静王爷好快跟上", "我们在后面 OK 爽吃一波", "他们绝对想不到头上有条龙"), 97_000, "zh-CN"
    )
    assert verdict.result is TranscriptSanityResult.VALID


@pytest.mark.parametrize("source_lang", [None, "", "en", "vi", "auto"])
def test_latin_or_unknown_source_skips_script_check(source_lang):
    verdict = TranscriptSanityValidator.validate(_segs(*["I'm very happy."] * 20), 97_000, source_lang)
    assert verdict.result is TranscriptSanityResult.VALID


def test_short_transcript_skips_script_check():
    verdict = TranscriptSanityValidator.validate(_segs("OK"), 97_000, "ja")
    assert verdict.result is TranscriptSanityResult.VALID


@pytest.mark.parametrize(
    ("url", "filename", "mime"),
    [
        ("http://minio/transflow-media/extracted/j/a.wav?X-Amz-Signature=abc", "audio.wav", "audio/wav"),
        ("http://minio/b/clip.MP3?sig=1", "audio.mp3", "audio/mpeg"),
        ("http://minio/b/no-extension?sig=1", "audio.wav", "audio/wav"),
    ],
)
async def test_multipart_upload_carries_real_audio_extension(tmp_path, url, filename, mime):
    downloaded = tmp_path / "tmp123.bin"
    downloaded.write_bytes(b"RIFF")
    adapter = MagicMock()
    adapter.prefers_audio_url.return_value = False
    with patch.object(stt_gateway, "_download_audio", new=AsyncMock(return_value=downloaded)):
        audio = await stt_gateway._prepare_audio_input(adapter, url)
    assert (audio.filename, audio.mime_type) == (filename, mime)
    assert not Path(downloaded).exists()
