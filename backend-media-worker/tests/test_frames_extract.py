"""Worker frame extraction tests (M17.1-A)."""
import os
import subprocess
import tempfile

def _ffmpeg_available():
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5, check=True)
        return True
    except Exception:
        return False

def _gen_video(path, duration=4):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"color=c=0x4682B4:s=320x240:d={duration}:r=10",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=15)

def test_extract_frame_to_base64():
    if not _ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not available")
    from app.services.frame_sampler import extract_frame_to_base64
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "test.mp4")
        _gen_video(video, 4)
        data_url, w, h, sha = extract_frame_to_base64(video, 1000)
        assert data_url.startswith("data:image/jpeg;base64,")
        assert w > 0 and h > 0
        assert len(sha) == 64

def test_extract_frames_as_data_urls_batch():
    if not _ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not available")
    from app.services.frame_sampler import extract_frames_as_data_urls
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "test.mp4")
        _gen_video(video, 6)
        frames = extract_frames_as_data_urls(video, [0, 2000, 4000])
        assert len(frames) == 3
        assert {f["timestamp"] for f in frames} == {0, 2000, 4000}
        for f in frames:
            assert f["frame_ref"].startswith("data:image/jpeg;base64,")
            assert "sha256" in f and len(f["sha256"]) == 64

def test_max_frames_enforced():
    from app.services.frame_sampler import extract_frames_as_data_urls, MAX_FRAMES_BATCH
    assert MAX_FRAMES_BATCH == 30
    if not _ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not available")
    import tempfile, os, subprocess
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "test.mp4")
        _gen_video(video, 2)
        try:
            extract_frames_as_data_urls(video, list(range(0, 31000, 1000)))
            assert False, "should have raised"
        except Exception as e:
            assert "max" in str(e).lower()

def test_invalid_video_fail_closed():
    from app.services.frame_sampler import extract_frame_to_base64
    try:
        extract_frame_to_base64("/nonexistent/path.mp4", 0)
        assert False, "should raise"
    except Exception:
        pass
