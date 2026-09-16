from unittest.mock import patch

import pytest

from app.services.ffmpeg import CutRange, SegmentAudio
from app.services.legacy_render_audio import resolve_legacy_audio


def test_legacy_original_calls_only_original_builder():
    ranges = [CutRange(start_ms=0, end_ms=1_000)]
    with patch(
        "app.services.legacy_render_audio.build_original_audio",
        return_value="final.wav",
    ) as original, patch(
        "app.services.legacy_render_audio.build_dubbed_audio"
    ) as dubbed:
        path, warnings = resolve_legacy_audio(
            "LEGACY_ORIGINAL", "ORIGINAL", None, "source.mp4", ranges, "temp"
        )

    assert path == "final.wav"
    assert warnings == []
    original.assert_called_once()
    dubbed.assert_not_called()


def test_legacy_dubbed_calls_only_dubbed_builder():
    ranges = [CutRange(start_ms=0, end_ms=1_000)]
    segments = [SegmentAudio("segment-1", "media/tts.wav", 0, 1_000)]
    with patch(
        "app.services.legacy_render_audio.build_dubbed_audio",
        return_value=("dubbed.wav", [{"code": "WARNING"}]),
    ) as dubbed, patch(
        "app.services.legacy_render_audio.build_original_audio"
    ) as original:
        path, warnings = resolve_legacy_audio(
            "LEGACY_DUBBED", "DUBBED", segments, "source.mp4", ranges, "temp"
        )

    assert path == "dubbed.wav"
    assert warnings == [{"code": "WARNING"}]
    dubbed.assert_called_once()
    original.assert_not_called()


def test_legacy_bridge_rejects_ambiguous_descriptor():
    with pytest.raises(ValueError, match="requires DUBBED mode"):
        resolve_legacy_audio(
            "LEGACY_DUBBED",
            "ORIGINAL",
            None,
            "source.mp4",
            [CutRange(start_ms=0, end_ms=1_000)],
            "temp",
        )
