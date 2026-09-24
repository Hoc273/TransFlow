"""Measured clip duration travels with every synthesized TTS result.

Spring places narration on the output timeline from this value, so it must be
reported for any provider audio format (WAV, MP3, OGG), not only WAV.
"""
from __future__ import annotations

import io

import pytest
from pydub import AudioSegment
from pydub.generators import Sine

from app.services.tts_gateway import audio_duration_ms


def _encoded(fmt: str, duration_ms: int) -> bytes:
    buffer = io.BytesIO()
    Sine(440).to_audio_segment(duration=duration_ms).export(buffer, format=fmt)
    return buffer.getvalue()


@pytest.mark.parametrize("fmt", ["wav", "mp3", "ogg"])
def test_duration_is_measured_for_common_provider_formats(fmt: str) -> None:
    measured = audio_duration_ms(_encoded(fmt, 1500))

    assert measured is not None
    assert abs(measured - 1500) <= 80


def test_undecodable_audio_reports_no_duration() -> None:
    assert audio_duration_ms(b"not audio") is None
    assert audio_duration_ms(b"") is None
