"""ADR-CEP Phase C1 — internal probe endpoint boundary tests (docs/93 §4.8.4, §3.20 TC-CEP-65..68)."""

from __future__ import annotations

import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import probe
from app.services.ffmpeg import FFmpegError
from app.services.media_probe import (
    AudioStreamInfo,
    MediaProbeResult,
    SubtitleStreamInfo,
    VideoStreamInfo,
)


class FakeStorage:
    """MinIO stub: download materializes a local file without network I/O."""

    def __init__(self, fail_download: bool = False) -> None:
        self.fail_download = fail_download
        self.download_calls = 0

    def download(self, ref: str, dest_path: str) -> None:
        self.download_calls += 1
        if self.fail_download:
            raise RuntimeError("bucket unreachable")
        with open(dest_path, "wb") as handle:
            handle.write(b"fake-video-bytes")


@pytest.fixture
def client(monkeypatch) -> TestClient:
    app = FastAPI()
    app.include_router(probe.router)
    return TestClient(app)


@pytest.fixture
def storage(monkeypatch) -> FakeStorage:
    stub = FakeStorage()
    monkeypatch.setattr("app.api.probe.get_storage", lambda: stub)
    return stub


def _probe_result() -> MediaProbeResult:
    return MediaProbeResult(
        container="mp4",
        duration_ms=1_000,
        video=VideoStreamInfo("h264", 1920, 1080, 30, 1, 4_200_000),
        audio=AudioStreamInfo("aac", 2, 44_100, 128_000),
        subtitle_streams=(SubtitleStreamInfo("subrip", "eng", 2),),
        warnings=("audio stream missing",),
    )


class TestProbeEndpoint:

    # TC-CEP-67: internal contract round-trip — payload is the C0 MediaProbeResult
    # in camelCase (analysisVersion included), exactly one download + one ffprobe.
    def test_probe_round_trip_returns_payload_and_probes_once(self, client, storage, monkeypatch):
        calls = {"probe": 0}

        def fake_probe(path: str) -> MediaProbeResult:
            calls["probe"] += 1
            assert path.endswith("source_video")
            return _probe_result()

        monkeypatch.setattr("app.api.probe.probe_video", fake_probe)

        response = client.post("/probe", json={"ref": "bucket/object/key.mp4"})

        assert response.status_code == 200
        payload = response.json()
        assert payload["container"] == "mp4"
        assert payload["durationMs"] == 1_000
        assert payload["video"]["codecName"] == "h264"
        assert payload["audio"]["channels"] == 2
        assert payload["subtitleStreams"][0]["codecName"] == "subrip"
        assert payload["warnings"] == ["audio stream missing"]
        assert payload["analysisVersion"] == 1
        assert storage.download_calls == 1
        assert calls["probe"] == 1  # TC-CEP-65: probe exactly once, no secondary probe

    # TC-CEP-68: malformed metadata maps to PROBE_PAYLOAD_INVALID, no temp path leak.
    def test_malformed_ffprobe_maps_to_payload_invalid(self, client, storage, monkeypatch):
        def fake_probe(path: str):
            raise FFmpegError(
                "ffprobe returned malformed metadata", "RENDER_VALIDATION_FAILED", retryable=False)

        monkeypatch.setattr("app.api.probe.probe_video", fake_probe)

        response = client.post("/probe", json={"ref": "bucket/key.mp4"})

        assert response.status_code == 422
        body = response.json()
        assert body["detail"]["code"] == "PROBE_PAYLOAD_INVALID"
        assert "tmp" not in response.text and "stderr" not in response.text

    def test_ffprobe_failure_maps_to_execution_failed(self, client, storage, monkeypatch):
        def fake_probe(path: str):
            raise FFmpegError("ffprobe failed", "RENDER_VALIDATION_FAILED", retryable=False)

        monkeypatch.setattr("app.api.probe.probe_video", fake_probe)

        response = client.post("/probe", json={"ref": "bucket/key.mp4"})

        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "PROBE_EXECUTION_FAILED"

    def test_ffprobe_timeout_maps_to_execution_failed(self, client, storage, monkeypatch):
        def fake_probe(path: str):
            raise FFmpegError("ffprobe timed out", "RENDER_VALIDATION_FAILED", retryable=False)

        monkeypatch.setattr("app.api.probe.probe_video", fake_probe)

        response = client.post("/probe", json={"ref": "bucket/key.mp4"})

        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "PROBE_EXECUTION_FAILED"

    def test_download_failure_maps_to_object_unavailable(self, client, storage):
        storage.fail_download = True

        response = client.post("/probe", json={"ref": "bucket/key.mp4"})

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "PROBE_OBJECT_UNAVAILABLE"

    def test_blank_ref_rejected(self, client, storage):
        response = client.post("/probe", json={"ref": "  "})

        assert response.status_code == 422  # handler-level blank check
        assert storage.download_calls == 0

    def test_temp_dir_cleaned_up_after_success(self, client, storage, monkeypatch):
        target = os.path.join(tempfile.gettempdir(), "probe_cleanup_success")
        os.makedirs(target, exist_ok=True)
        monkeypatch.setattr("app.api.probe.tempfile.mkdtemp", lambda *a, **k: target)
        monkeypatch.setattr("app.api.probe.probe_video", lambda path: _probe_result())

        response = client.post("/probe", json={"ref": "bucket/key.mp4"})

        assert response.status_code == 200
        assert not os.path.exists(target)

    def test_temp_dir_cleaned_up_after_ffprobe_failure(self, client, storage, monkeypatch):
        target = os.path.join(tempfile.gettempdir(), "probe_cleanup_ffprobe")
        os.makedirs(target, exist_ok=True)
        monkeypatch.setattr("app.api.probe.tempfile.mkdtemp", lambda *a, **k: target)

        def fail(path: str):
            raise FFmpegError("ffprobe failed", "RENDER_VALIDATION_FAILED", retryable=False)

        monkeypatch.setattr("app.api.probe.probe_video", fail)

        response = client.post("/probe", json={"ref": "bucket/key.mp4"})

        assert response.status_code == 502
        assert not os.path.exists(target)

    def test_temp_dir_cleaned_up_when_download_fails(self, client, storage, monkeypatch):
        target = os.path.join(tempfile.gettempdir(), "probe_cleanup_download")
        os.makedirs(target, exist_ok=True)
        monkeypatch.setattr("app.api.probe.tempfile.mkdtemp", lambda *a, **k: target)
        storage.fail_download = True

        response = client.post("/probe", json={"ref": "bucket/key.mp4"})

        assert response.status_code == 404
        assert not os.path.exists(target)

    # TC-CEP-66: no DB access — the endpoint module has no DB client imports.
    def test_probe_module_has_no_db_access(self):
        source = open(probe.__file__, encoding="utf-8").read()
        for forbidden in ("sqlalchemy", "psycopg", "sqlite3", "database", "postgres"):
            assert forbidden not in source.lower()
