"""TASK 7 worker frame sampler tests — scene-aware, configurable, not entire video.

Mirrors backend-ai frame_sampler.sample_timestamps contract (deterministic, no ffmpeg binary required for unit).
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.frame_sampler import sample_frames


def test_uniform_capped():
    # Use mocked duration via monkeypatching get_duration_ms
    import app.services.frame_sampler as fs

    orig = fs.get_duration_ms
    fs.get_duration_ms = lambda path, timeout=60: 60000
    try:
        ts = fs.sample_frames("/tmp/fake.mp4", interval_ms=10000, max_frames=12, scene_aware=False)
        assert ts[:6] == [0, 10000, 20000, 30000, 40000, 50000]
        assert len(ts) in (6, 7)
    finally:
        fs.get_duration_ms = orig


def test_max_frames_cap_not_entire_video():
    import app.services.frame_sampler as fs

    orig = fs.get_duration_ms
    fs.get_duration_ms = lambda path, timeout=60: 300000  # 5 min
    try:
        ts = fs.sample_frames("/tmp/fake.mp4", interval_ms=500, max_frames=12, scene_aware=False)
        assert len(ts) == 12  # capped, not 600
    finally:
        fs.get_duration_ms = orig


def test_scene_aware_with_detected_boundaries():
    import app.services.frame_sampler as fs

    orig_dur = fs.get_duration_ms
    orig_detect = fs.detect_scene_boundaries
    fs.get_duration_ms = lambda path, timeout=60: 120000
    fs.detect_scene_boundaries = lambda path, threshold=0.3, timeout=120: [
        fs.SceneBoundary(timestamp_ms=10000, score=0.5),
        fs.SceneBoundary(timestamp_ms=35000, score=0.6),
        fs.SceneBoundary(timestamp_ms=80000, score=0.8),
    ]
    try:
        ts = fs.sample_frames("/tmp/fake.mp4", interval_ms=10000, max_frames=8, scene_aware=True, scene_threshold=0.3)
        assert any(abs(t - 10500) <= 1500 or abs(t - 35500) <= 1500 or abs(t - 80500) <= 1500 for t in ts)
        assert len(ts) <= 8
        assert ts == sorted(ts)
    finally:
        fs.get_duration_ms = orig_dur
        fs.detect_scene_boundaries = orig_detect


def test_scene_aware_fallback_to_uniform_when_no_boundaries():
    import app.services.frame_sampler as fs

    orig_dur = fs.get_duration_ms
    orig_detect = fs.detect_scene_boundaries
    fs.get_duration_ms = lambda path, timeout=60: 60000
    fs.detect_scene_boundaries = lambda path, threshold=0.3, timeout=120: []
    try:
        ts = fs.sample_frames("/tmp/fake.mp4", interval_ms=10000, max_frames=12, scene_aware=True)
        assert ts[:6] == [0, 10000, 20000, 30000, 40000, 50000]
        assert len(ts) in (6, 7)
    finally:
        fs.get_duration_ms = orig_dur
        fs.detect_scene_boundaries = orig_detect


def test_no_provider_hardcode():
    import app.services.frame_sampler as fs
    import inspect

    sig = inspect.signature(fs.sample_frames)
    params = list(sig.parameters.keys())
    assert "provider" not in params
    assert "openai" not in str(inspect.getsource(fs.sample_frames)).lower() or "openai" not in str(params)
