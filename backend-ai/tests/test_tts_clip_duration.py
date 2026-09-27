"""Measured clip duration travels with every synthesized TTS result.

Spring places narration on the output timeline from this value, so it must be
reported for any provider audio format (WAV, MP3, OGG), not only WAV.
"""
from __future__ import annotations

import subprocess

import pytest

from app.services.tts_gateway import audio_duration_ms

# Fixtures are encoded with ffmpeg (already required by the gateway) rather than pydub,
# which is not a declared dependency.
_FFMPEG_FORMAT_ARGS = {
    "wav": ["-f", "wav"],
    "mp3": ["-c:a", "libmp3lame", "-f", "mp3"],
    "ogg": ["-c:a", "libvorbis", "-f", "ogg"],
}


def _encoded(fmt: str, duration_ms: int) -> bytes:
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-hide_banner", "-f", "lavfi",
         "-i", f"sine=frequency=440:duration={duration_ms / 1000}",
         *_FFMPEG_FORMAT_ARGS[fmt], "pipe:1"],
        capture_output=True,
        check=True,
    ).stdout


@pytest.mark.parametrize("fmt", ["wav", "mp3", "ogg"])
def test_duration_is_measured_for_common_provider_formats(fmt: str) -> None:
    measured = audio_duration_ms(_encoded(fmt, 1500))

    assert measured is not None
    assert abs(measured - 1500) <= 80


def test_undecodable_audio_reports_no_duration() -> None:
    assert audio_duration_ms(b"not audio") is None
    assert audio_duration_ms(b"") is None
