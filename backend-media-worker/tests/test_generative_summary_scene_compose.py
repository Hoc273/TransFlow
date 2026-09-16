"""M17.3 — Generative summary scene composition tests.

Requirements:
- M17.3-A: Summary scene contract
- M17.3-B: Visual strategy (SOURCE_CLIP, GENERATED_IMAGE, MIXED)
- M17.3-C: Action-heavy behavior
- M17.3-D: Accurate source clip extraction & ffprobe duration validation (fail-closed)
- M17.3-E: Composition without LLM in renderer
"""
import os
import subprocess
import tempfile
import pytest

from app.services import generative_compose
from app.services.ffmpeg import FFmpegError, get_duration
from app.services.generative_compose import (
    VisualBeatInput,
    validate_extracted_clip_duration,
    _extract_and_rescale_beat,
    compose_generative_summary,
    probe_source_duration,
)


def _ffmpeg_present():
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5, check=True)
        return True
    except Exception:
        return False


def _create_synthetic_video(path: str, duration_s: int = 10, width: int = 640, height: int = 360):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"color=c=blue:s={width}x{height}:d={duration_s}",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        path,
    ]
    subprocess.run(cmd, capture_output=True, check=True)


def _create_synthetic_av_video(
    path: str,
    video_duration_s: float = 26.600,
    audio_duration_s: float = 27.736,
):
    """Create the production topology: audio/container outlives video frames."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"color=c=blue:s=640x360:d={video_duration_s}",
        "-f", "lavfi",
        "-i", f"sine=frequency=440:duration={audio_duration_s}",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-t", str(audio_duration_s),
        path,
    ]
    subprocess.run(cmd, capture_output=True, check=True)


def _create_synthetic_delayed_video(path: str):
    """Create a video-only stream whose v:0 starts at 3382ms."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", "color=c=blue:s=640x360:r=30:d=18.2",
        "-vf", "settb=1/1000,setpts=PTS+3382",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-fps_mode:v", "passthrough",
        path,
    ]
    subprocess.run(cmd, capture_output=True, check=True)


def _create_synthetic_audio(path: str, duration_s: float = 3.0):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"sine=frequency=440:duration={duration_s}",
        "-c:a", "pcm_s16le",
        path,
    ]
    subprocess.run(cmd, capture_output=True, check=True)


def _create_synthetic_image(path: str, width: int = 512, height: int = 512):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"color=c=red:s={width}x{height}",
        "-vframes", "1",
        path,
    ]
    subprocess.run(cmd, capture_output=True, check=True)


@pytest.mark.skipif(not _ffmpeg_present(), reason="ffmpeg required")
class TestGenerativeSummarySceneCompose:

    def test_duration_validation_passes_within_tolerance(self, tmp_path):
        vid_path = str(tmp_path / "test_5s.mp4")
        _create_synthetic_video(vid_path, duration_s=5)
        # 5000ms expected, within 500ms tolerance
        validate_extracted_clip_duration(vid_path, expected_duration_ms=5000, tolerance_ms=500)

    def test_duration_validation_fail_closed_on_mismatch(self, tmp_path):
        vid_path = str(tmp_path / "test_5s.mp4")
        _create_synthetic_video(vid_path, duration_s=5)
        # Expect 10000ms, actual is 5000ms -> delta 5000ms > 500ms -> must raise FFmpegError
        with pytest.raises(FFmpegError) as exc_info:
            validate_extracted_clip_duration(vid_path, expected_duration_ms=10000, tolerance_ms=500)
        assert "VALIDATION_FAILED" in str(exc_info.value.code)

    def test_generated_image_visual_strategy(self, tmp_path):
        img_path = str(tmp_path / "frame.png")
        _create_synthetic_image(img_path)
        beat = VisualBeatInput(
            id="beat-img-001",
            narration_segment="Generated image visualization",
            visual_description="A descriptive infographic image",
            source_start_ms=0,
            source_end_ms=0,
            visual_strategy="GENERATED_IMAGE",
            tts_duration_ms=3000,
            generated_asset_path=img_path,
        )
        out_path = str(tmp_path / "rendered_scene.mp4")
        _extract_and_rescale_beat(source_path="", beat=beat, output_path=out_path, temp_dir=str(tmp_path))
        assert os.path.exists(out_path)
        actual_dur = get_duration(out_path)
        assert abs(actual_dur - 3.0) < 0.5

    def test_source_shorter_than_tts_is_padded_to_measured_duration(self, tmp_path):
        """Production regression: 18.120s source -> 23.103s measured TTS."""
        source_vid = str(tmp_path / "source.mp4")
        _create_synthetic_video(source_vid, duration_s=25)
        beat = VisualBeatInput(
            id="production-long-tts",
            narration_segment="A long measured narration beat.",
            visual_description="Grounded source footage",
            source_start_ms=0,
            source_end_ms=18_120,
            visual_strategy="SOURCE_CUT",
            tts_duration_ms=23_103,
        )
        out_path = str(tmp_path / "padded_scene.mp4")

        _extract_and_rescale_beat(source_vid, beat, out_path, str(tmp_path))

        assert abs(get_duration(out_path) - 23.103) < 0.5

    def test_delayed_video_stream_uses_input_relative_seek_and_tts_duration(self, tmp_path, monkeypatch):
        source_vid = str(tmp_path / "delayed_source.mp4")
        _create_synthetic_delayed_video(source_vid)
        source_probe = probe_source_duration(source_vid)
        assert abs(source_probe.video_stream_start_ms - 3_382) < 50
        assert abs(source_probe.video_stream_duration_ms - 18_167) < 100
        assert abs(source_probe.video_stream_end_ms - 21_549) < 100

        beat = VisualBeatInput(
            id="delayed-stream",
            narration_segment="The delayed video stream starts after the container timeline.",
            visual_description="Delayed source footage",
            source_start_ms=0,
            source_end_ms=21_548,
            visual_strategy="SOURCE_CUT",
            tts_duration_ms=21_548,
        )
        out_path = str(tmp_path / "delayed_scene.mp4")
        commands = []
        real_run = generative_compose._run

        def capture_run(cmd, *args, **kwargs):
            commands.append(list(cmd))
            return real_run(cmd, *args, **kwargs)

        monkeypatch.setattr(generative_compose, "_run", capture_run)
        _extract_and_rescale_beat(
            source_vid,
            beat,
            out_path,
            str(tmp_path),
            source_duration_probe=source_probe,
        )

        assert abs(get_duration(out_path) - 21.548) < 0.5
        source_cmd = commands[0]
        assert float(source_cmd[source_cmd.index("-ss") + 1]) == pytest.approx(0.0)
        assert "-t" not in source_cmd
        source_filter = source_cmd[source_cmd.index("-vf") + 1]
        effective_start_ms = max(0, source_probe.video_stream_start_ms)
        effective_end_ms = min(21_548, source_probe.video_stream_end_ms)
        assert effective_end_ms - effective_start_ms == pytest.approx(18_166, abs=100)
        expected_source_duration = f"trim=duration={(effective_end_ms - effective_start_ms) / 1000:.6f}"
        assert expected_source_duration in source_filter
        assert "tpad=stop_mode=clone:stop_duration=21.548000" in source_filter
        assert source_filter.index("tpad=") < source_filter.index("trim=duration=21.548000")
        assert source_filter.endswith("fps=30")

    def test_delayed_video_stream_after_start_converts_seek_offset(self, tmp_path, monkeypatch):
        source_vid = str(tmp_path / "delayed_source_after_start.mp4")
        _create_synthetic_delayed_video(source_vid)
        source_probe = probe_source_duration(source_vid)
        beat = VisualBeatInput(
            id="delayed-stream-after-start",
            narration_segment="The beat begins after the delayed stream start.",
            visual_description="Delayed source footage",
            source_start_ms=10_000,
            source_end_ms=18_000,
            visual_strategy="SOURCE_CUT",
            tts_duration_ms=8_000,
        )
        out_path = str(tmp_path / "delayed_after_start_scene.mp4")
        commands = []
        real_run = generative_compose._run

        def capture_run(cmd, *args, **kwargs):
            commands.append(list(cmd))
            return real_run(cmd, *args, **kwargs)

        monkeypatch.setattr(generative_compose, "_run", capture_run)
        _extract_and_rescale_beat(
            source_vid,
            beat,
            out_path,
            str(tmp_path),
            source_duration_probe=source_probe,
        )

        seek_offset_ms = float(commands[0][commands[0].index("-ss") + 1]) * 1000
        assert seek_offset_ms == pytest.approx(10_000 - source_probe.video_stream_start_ms, abs=1)
        assert seek_offset_ms == pytest.approx(6_618, abs=50)
        assert seek_offset_ms != pytest.approx(10_000, abs=50)
        assert abs(get_duration(out_path) - 8.0) < 0.5

    def test_video_stream_eof_clamps_container_longer_than_video_and_pads(self, tmp_path):
        """Production regression: 26.600s video + 27.736s audio/container."""
        source_vid = str(tmp_path / "audio_longer_than_video.mp4")
        _create_synthetic_av_video(source_vid)
        source_probe = probe_source_duration(source_vid)
        assert source_probe.container_duration_ms is not None
        assert source_probe.container_duration_ms >= 27_700
        assert abs(source_probe.video_stream_duration_ms - 26_600) < 300

        beat = VisualBeatInput(
            id="container-tail",
            narration_segment="The audio container outlives the visual track.",
            visual_description="Grounded source footage",
            source_start_ms=0,
            source_end_ms=27_736,
            visual_strategy="SOURCE_CUT",
            tts_duration_ms=27_736,
        )
        out_path = str(tmp_path / "container_tail_scene.mp4")

        _extract_and_rescale_beat(
            source_vid,
            beat,
            out_path,
            str(tmp_path),
            source_duration_probe=source_probe,
        )

        assert abs(get_duration(out_path) - 27.736) < 0.5

    def test_source_start_after_video_eof_but_before_container_eof_fails(self, tmp_path):
        source_vid = str(tmp_path / "audio_longer_than_video.mp4")
        _create_synthetic_av_video(source_vid)
        source_probe = probe_source_duration(source_vid)
        beat = VisualBeatInput(
            id="after-video-eof",
            narration_segment="This range has only container audio after video EOF.",
            visual_description="Missing visual footage",
            source_start_ms=27_000,
            source_end_ms=27_736,
            visual_strategy="SOURCE_CUT",
            tts_duration_ms=1_000,
        )

        with pytest.raises(FFmpegError) as exc_info:
            _extract_and_rescale_beat(
                source_vid,
                beat,
                str(tmp_path / "after_video_eof.mp4"),
                str(tmp_path),
                source_duration_probe=source_probe,
            )

        assert exc_info.value.code == "GENERATIVE_SOURCE_RANGE_OUT_OF_BOUNDS"
        assert exc_info.value.details["containerDurationMs"] >= 27_700
        assert exc_info.value.details["videoStreamEndMs"] < 27_000

    def test_source_end_is_clamped_at_physical_eof_before_padding(self, tmp_path):
        source_vid = str(tmp_path / "near_eof.mp4")
        _create_synthetic_video(source_vid, duration_s=5)
        beat = VisualBeatInput(
            id="near-eof",
            narration_segment="The beat reaches the end of the source.",
            visual_description="Near EOF footage",
            source_start_ms=3_000,
            source_end_ms=7_000,
            visual_strategy="SOURCE_CUT",
            tts_duration_ms=3_000,
        )
        out_path = str(tmp_path / "near_eof_scene.mp4")

        _extract_and_rescale_beat(source_vid, beat, out_path, str(tmp_path))

        assert abs(get_duration(out_path) - 3.0) < 0.5

    def test_source_start_after_physical_eof_fails_non_retryable(self, tmp_path):
        source_vid = str(tmp_path / "short.mp4")
        _create_synthetic_video(source_vid, duration_s=5)
        beat = VisualBeatInput(
            id="after-eof",
            narration_segment="This range cannot be grounded.",
            visual_description="Missing footage",
            source_start_ms=5_001,
            source_end_ms=7_000,
            visual_strategy="SOURCE_CUT",
            tts_duration_ms=2_000,
        )

        with pytest.raises(FFmpegError) as exc_info:
            _extract_and_rescale_beat(
                source_vid,
                beat,
                str(tmp_path / "invalid_scene.mp4"),
                str(tmp_path),
            )

        assert exc_info.value.code == "GENERATIVE_SOURCE_RANGE_OUT_OF_BOUNDS"
        assert exc_info.value.retryable is False
        assert exc_info.value.details["beatId"] == "after-eof"

    def test_e2e_two_scene_summary_compose(self, tmp_path):
        source_vid = str(tmp_path / "source.mp4")
        _create_synthetic_video(source_vid, duration_s=20)

        tts1 = str(tmp_path / "tts1.wav")
        tts2 = str(tmp_path / "tts2.wav")
        _create_synthetic_audio(tts1, duration_s=3.0)
        _create_synthetic_audio(tts2, duration_s=4.0)

        beats = [
            VisualBeatInput(
                id="scene-001",
                narration_segment="Opening action unfolds.",
                visual_description="Opening action",
                source_start_ms=1000,
                source_end_ms=6000,
                visual_strategy="SOURCE_CLIP",
                tts_duration_ms=3000,
            ),
            VisualBeatInput(
                id="scene-002",
                narration_segment="The climax concludes successfully.",
                visual_description="Climax scene",
                source_start_ms=10000,
                source_end_ms=18000,
                visual_strategy="SOURCE_CLIP",
                tts_duration_ms=4000,
            ),
        ]

        output_mp4 = str(tmp_path / "summary_output.mp4")
        result = compose_generative_summary(
            source_video_path=source_vid,
            beats=beats,
            tts_audio_paths=[tts1, tts2],
            output_path=output_mp4,
            temp_dir=str(tmp_path),
        )
        assert os.path.exists(result)
        dur = get_duration(result)
        # TTS is the beat timeline authority: 3s + 4s = 7s.
        assert abs(dur - 7.0) < 0.6
