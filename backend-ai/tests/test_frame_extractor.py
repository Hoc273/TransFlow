"""M17.1-A unit tests — real frame extraction (no mock fallback).

Covers:
- extract single frame to data URL
- batch extraction preserves timestamps
- checksum differs per timestamp if visual differs
- invalid video fail-closed
- oversized / timeout handling (mock)
- MIME header validation
"""
import base64
import hashlib
import os
import subprocess
import tempfile
from pathlib import Path

import pytest

def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5, check=True)
        return True
    except Exception:
        return False

def _generate_test_video(path: str, duration: int = 5) -> None:
    """Generate a simple test video (color bars) for extraction tests."""
    # Use ffmpeg testsrc — deterministic, no external file
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"testsrc=duration={duration}:size=320x240:rate=10",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-t", str(duration),
        path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=30)

def _generate_fight_video(path: str, duration: int = 12) -> None:
    """Generate 12s fight-like video: 0-4s blue, 4-9s red, 9-12s gray — for checksum variance."""
    # Create 3 segments then concat
    tmpdir = tempfile.mkdtemp(prefix="fight_gen_")
    try:
        seg1 = os.path.join(tmpdir, "seg1.mp4")
        seg2 = os.path.join(tmpdir, "seg2.mp4")
        seg3 = os.path.join(tmpdir, "seg3.mp4")
        for seg, color, dur in [(seg1, "0x4682B4", 4), (seg2, "0xB22222", 5), (seg3, "0x696969", 3)]:
            cmd = [
                "ffmpeg", "-y",
                "-f", "lavfi",
                "-i", f"color=c={color}:s=320x240:d={dur}:r=10",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                seg,
            ]
            subprocess.run(cmd, check=True, capture_output=True, timeout=15)
        # concat
        list_path = os.path.join(tmpdir, "list.txt")
        with open(list_path, "w") as f:
            for seg in [seg1, seg2, seg3]:
                f.write(f"file '{seg}'\n")
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", list_path,
            "-c", "copy",
            path,
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=15)
    finally:
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)

@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg not available")
def test_extract_single_frame_to_data_url():
    from app.services.visual.frame_extractor import extract_frames_as_data_urls
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "test.mp4")
        _generate_test_video(video, duration=5)
        samples = extract_frames_as_data_urls(video, video, [1000])
        assert len(samples) == 1
        s = samples[0]
        assert s["timestamp"] == 1000
        assert s["frame_ref"].startswith("data:image/jpeg;base64,")
        # validate base64 decodes to JPEG
        b64 = s["frame_ref"].split(",", 1)[1]
        data = base64.b64decode(b64)
        assert data[:2] == b"\xff\xd8"  # JPEG header
        assert len(data) < 2 * 1024 * 1024
        assert s["_bytes"] == len(data)
        # sha256 matches
        assert s["_sha256"] == hashlib.sha256(data).hexdigest()
        assert s["_width"] > 0 and s["_height"] > 0

@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg not available")
def test_batch_preserves_timestamps_and_checksum_variance():
    from app.services.visual.frame_extractor import extract_frames_as_data_urls
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "fight.mp4")
        _generate_fight_video(video, duration=12)
        timestamps = [0, 2000, 5000, 9000]
        samples = extract_frames_as_data_urls(video, video, timestamps)
        assert len(samples) == 4
        assert [s["timestamp"] for s in samples] == sorted(timestamps)
        # checksums should differ across color phases (blue vs red vs gray)
        shas = [s["_sha256"] for s in samples]
        assert len(set(shas)) >= 2, f"Expected variance but got {shas}"
        # each is data URL
        for s in samples:
            assert s["frame_ref"].startswith("data:image/")

@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg not available")
def test_invalid_video_fail_closed():
    from app.services.visual.frame_extractor import extract_frames_as_data_urls
    from app.services.provider_errors import ProviderValidation
    with pytest.raises(ProviderValidation):
        extract_frames_as_data_urls("/nonexistent/video.mp4", "/nonexistent/video.mp4", [0])

def test_oversized_frame_limit():
    from app.services.visual.frame_extractor import extract_frames_as_data_urls
    from app.services.provider_errors import ProviderValidation
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "dummy.mp4")
        # use existing test video but ask for 31 frames > max 30
        if _ffmpeg_available():
            _generate_test_video(video, duration=5)
            with pytest.raises(ProviderValidation) as exc:
                extract_frames_as_data_urls(video, video, list(range(0, 31000, 1000)))
            assert "max 30" in str(exc.value).lower() or "exceeds" in str(exc.value).lower()
        else:
            pytest.skip("ffmpeg not available")

def test_mime_header_validation():
    from app.services.visual.frame_extractor import _validate_image_bytes
    from app.services.provider_errors import ProviderValidation
    # valid JPEG
    assert _validate_image_bytes(b"\xff\xd8\xff\xe0" + b"\x00"*100) == "image/jpeg"
    # valid PNG
    assert _validate_image_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00"*100) == "image/png"
    # invalid
    with pytest.raises(ProviderValidation):
        _validate_image_bytes(b"BADHEADER" + b"\x00"*100)

@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg not available")
def test_max_frames_enforced():
    from app.services.visual.frame_extractor import MAX_FRAMES
    assert MAX_FRAMES == 30
