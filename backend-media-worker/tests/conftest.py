import pytest

from app.services.media_probe import (
    AudioStreamInfo,
    MediaProbeResult,
    SubtitleStreamInfo,
    VideoStreamInfo,
)
from app.services import render_validation


@pytest.fixture(autouse=True)
def stub_render_probe(monkeypatch):
    """Keep existing render unit tests independent from the ffprobe executable."""
    monkeypatch.setattr(
        "app.api.render.probe_video",
        lambda path: MediaProbeResult(
            container="mp4",
            duration_ms=int(round(render_validation.get_duration(path) * 1_000)),
            video=VideoStreamInfo("h264", 1920, 1080, 30, 1, None)
            if "video" in render_validation.get_stream_types(path) else None,
            audio=AudioStreamInfo("aac", 2, 44_100, None)
            if "audio" in render_validation.get_stream_types(path) else None,
            subtitle_streams=(SubtitleStreamInfo("subrip", None, 2),)
            if "subtitle" in render_validation.get_stream_types(path) else (),
            warnings=(),
        ),
    )


@pytest.fixture(autouse=True)
def _no_internal_token(monkeypatch):
    """Keep route tests independent from an INTERNAL_SERVICE_TOKEN in the developer's .env."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "internal_service_token", "")
