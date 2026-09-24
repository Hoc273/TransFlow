import os
import json
import sys
import subprocess
import unittest
from tempfile import TemporaryDirectory
from types import ModuleType
from unittest.mock import Mock, patch

from pydub import AudioSegment

from app.services.ffmpeg import (
    CutRange,
    FFmpegError,
    SegmentAudio,
    _run,
    _extract_video_segment,
    _srt_vtt_to_ass,
    build_dubbed_audio,
    burn_subtitles,
    fit_dub_audio,
    get_stream_types,
    has_audio_stream,
    probe_video_stream_duration,
)


class DubAudioTimingTest(unittest.TestCase):
    def test_ffmpeg_failure_log_does_not_expose_local_paths(self):
        failure = subprocess.CalledProcessError(
            1,
            ["ffmpeg"],
            stderr="invalid data in D:/private/source_video",
        )
        with patch("app.services.ffmpeg.subprocess.run", side_effect=failure), self.assertLogs(
            "app.services.ffmpeg", level="ERROR"
        ) as captured, self.assertRaisesRegex(FFmpegError, "ffmpeg command failed"):
            _run(["ffmpeg", "-i", "D:/private/source_video", "D:/private/output.wav"])

        self.assertNotIn("D:/private", "\n".join(captured.output))

    def test_video_cut_uses_accurate_decode_seek_and_drops_source_audio(self):
        with patch("app.services.ffmpeg._run") as run:
            _extract_video_segment("source.mp4", 65_000, 80_000, "cut.mp4")

        cmd = run.call_args.args[0]
        self.assertGreater(cmd.index("-ss"), cmd.index("-i"))
        self.assertIn("-an", cmd)
        self.assertIn("libx264", cmd)
        self.assertNotIn("copy", cmd)

    def test_short_audio_is_padded_without_warning(self):
        with TemporaryDirectory() as temp_dir:
            with patch(
                "app.services.ffmpeg.AudioSegment.from_file",
                return_value=AudioSegment.silent(duration=1_500),
            ):
                output_path, warning = fit_dub_audio("dub.wav", 2_000, temp_dir)

            self.assertIsNone(warning)
            self.assertEqual(2_000, len(AudioSegment.from_file(output_path)))

    def test_audio_up_to_twenty_percent_over_is_time_stretched_without_warning(self):
        with TemporaryDirectory() as temp_dir:
            with patch(
                "app.services.ffmpeg.AudioSegment.from_file",
                return_value=AudioSegment.silent(duration=2_300),
            ), patch("app.services.ffmpeg._run") as run:
                _, warning = fit_dub_audio("dub.wav", 2_000, temp_dir)

        self.assertIsNone(warning)
        cmd = run.call_args.args[0]
        self.assertIn("atempo=1.150000", cmd)
        self.assertEqual("2.0", cmd[cmd.index("-t") + 1])

    def test_audio_over_twenty_percent_is_truncated_with_warning(self):
        with TemporaryDirectory() as temp_dir:
            with patch(
                "app.services.ffmpeg.AudioSegment.from_file",
                return_value=AudioSegment.silent(duration=3_000),
            ), patch("app.services.ffmpeg._run") as run:
                _, warning = fit_dub_audio(
                    "dub.wav",
                    2_000,
                    temp_dir,
                    segment_id="seg-42",
                )

        self.assertEqual(
            {"code": "AUDIO_TRUNCATED", "exceeded_ms": 1_000, "segment_id": "seg-42"},
            warning,
        )
        cmd = run.call_args.args[0]
        self.assertIn("atempo=1.200000", cmd)
        self.assertEqual("2.0", cmd[cmd.index("-t") + 1])

    def test_stream_probe_requests_bare_values(self):
        """Phase D P0 regression: the probe must output values only (nokey=1).

        ffprobe 7.x with `-of default=nw=1` prints `codec_type=audio` lines, so
        `"audio" in get_stream_types(...)` matched nothing and EXTRACT_AUDIO
        failed with NO_AUDIO_STREAM for every video.
        """
        with patch("app.services.ffmpeg.subprocess.run") as run:
            run.return_value = Mock(stdout="video\naudio\n")
            result = get_stream_types("x.mp4")

        cmd = run.call_args.args[0]
        self.assertIn("default=noprint_wrappers=1:nokey=1", cmd)
        self.assertEqual(["video", "audio"], result)

    def test_video_duration_probe_uses_v0_not_container_duration(self):
        payload = {
            "format": {"duration": "27.736"},
            "streams": [
                {
                    "index": 0,
                    "codec_type": "video",
                    "start_time": "0.000000",
                    "duration": "26.600000",
                    "r_frame_rate": "30/1",
                },
                {"index": 1, "codec_type": "audio", "duration": "27.736000"},
            ],
        }
        with patch("app.services.ffmpeg.subprocess.run") as run:
            run.return_value = Mock(stdout=json.dumps(payload))
            result = probe_video_stream_duration("production.mp4")

        cmd = run.call_args.args[0]
        self.assertIn("-show_streams", cmd)
        self.assertEqual(27_736, result.container_duration_ms)
        self.assertEqual(26_600, result.video_stream_duration_ms)
        self.assertEqual(26_600, result.video_stream_end_ms)
        self.assertEqual("video_stream.duration", result.duration_source)

    def test_video_duration_probe_has_explicit_frame_timestamp_fallback(self):
        payload = {
            "format": {"duration": "27.736"},
            "streams": [{
                "index": 0,
                "codec_type": "video",
                "start_time": "0.000000",
                "duration": "N/A",
                "r_frame_rate": "30/1",
            }],
        }
        with patch("app.services.ffmpeg.subprocess.run") as run:
            run.side_effect = [
                Mock(stdout=json.dumps(payload)),
                Mock(stdout="0.000000,0.033333\n26.566667,0.033333\n"),
            ]
            result = probe_video_stream_duration("fallback.mp4")

        self.assertEqual(26_600, result.video_stream_end_ms)
        self.assertEqual("video_stream.frame_timestamps", result.duration_source)
        self.assertIsNotNone(result.fallback_diagnostic)

    def test_has_audio_stream_true_when_probe_reports_audio(self):
        with patch(
            "app.services.ffmpeg.get_stream_types", return_value=["video", "audio"]
        ):
            self.assertTrue(has_audio_stream("x.mp4"))

    def test_has_audio_stream_false_when_no_audio_stream(self):
        with patch(
            "app.services.ffmpeg.get_stream_types", return_value=["video"]
        ):
            self.assertFalse(has_audio_stream("x.mp4"))

    def test_burn_ass_applies_no_force_style_and_pins_fontsdir(self):
        # B1.0 (docs/93 §4.6.6): the ASS style is Spring-owned — force_style must
        # never be applied; fontsdir is pinned to the bundled DejaVu family.
        with patch("app.services.ffmpeg._run") as run:
            burn_subtitles(
                "source.mp4",
                "subs/out.ass",
                "render.mp4",
                position="TOP",
                vertical_offset_percent=20,
                background_box=False,
                subtitle_format="ass",
            )

        cmd = run.call_args.args[0]
        self.assertIn(
            "subtitles=subs/out.ass:fontsdir=/usr/share/fonts/truetype/dejavu", cmd
        )
        self.assertNotIn("force_style", cmd)
        self.assertIn("libx264", cmd)

    def test_burn_srt_still_applies_force_style(self):
        # The legacy SRT path keeps its inline styling (Alignment/MarginV/box).
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles("source.mp4", "subs/out.srt", "render.mp4", subtitle_format="srt")

        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("force_style", vf)
        self.assertNotIn("fontsdir", vf)

    def test_burn_srt_applies_typography_override_in_force_style(self):
        # Phase 3 (docs/16 §7.1): font_size/bold fold into force_style as
        # Fontsize/Bold on the legacy path only.
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                font_size=52,
                bold=True,
            )

        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("Fontsize=52", vf)
        self.assertIn("Bold=-1", vf)
        self.assertIn("Alignment=2", vf)

    def test_burn_srt_scales_typography_from_1080_reference_to_frame_height(self):
        # font_size/outline_width are authored for a 1080-line frame (Render
        # Studio preview PLAY_RES_Y); a 720-line output burns them at 2/3.
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=720
        ), patch("app.services.ffmpeg.get_video_width", return_value=1280):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                background_box=False,
                font_size=42,
                outline_width=4,
                outline_color="#FFFFFF",
            )

        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("Fontsize=28", vf)
        self.assertIn("Outline=3", vf)

    def test_burn_srt_bold_false_maps_to_zero(self):
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                font_size=16,
                bold=False,
            )

        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("Fontsize=16", vf)
        self.assertIn("Bold=0", vf)

    def test_burn_absent_typography_keeps_legacy_force_style(self):
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles("source.mp4", "subs/out.srt", "render.mp4", subtitle_format="srt")

        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertNotIn("Fontsize", vf)
        self.assertNotIn("Bold=", vf)

    def test_burn_invalid_font_size_fails_closed(self):
        with patch("app.services.ffmpeg.get_video_height", return_value=1080), patch(
            "app.services.ffmpeg.get_video_width", return_value=1920
        ):
            with self.assertRaises(FFmpegError) as ctx:
                burn_subtitles(
                    "source.mp4",
                    "subs/out.srt",
                    "render.mp4",
                    subtitle_format="srt",
                    font_size=15,
                )
        self.assertEqual("INVALID_INPUT", ctx.exception.code)
        self.assertFalse(ctx.exception.retryable)

    def test_burn_ass_ignores_typography_override(self):
        # Phase 3: typography must never reach the ASS path (Spring folds it into
        # the ASS itself) — force_style stays absent even when params are passed.
        with patch("app.services.ffmpeg._run") as run:
            burn_subtitles(
                "source.mp4",
                "subs/out.ass",
                "render.mp4",
                subtitle_format="ass",
                font_size=52,
                bold=True,
            )

        cmd = run.call_args.args[0]
        self.assertNotIn("force_style", cmd)
        self.assertNotIn("Fontsize", str(cmd))

    # ─── Phase 4 mask (docs/16 §7.1, TC-PRES-11/12) ──────────────────────

    MASK = {
        "enabled": True,
        "anchor": "SUBTITLE",
        "width_percent": 85,
        "height_percent": 12,
        "opacity_percent": 60,
        "padding_percent": 2,
    }

    def test_burn_srt_with_mask_combines_drawbox_and_subtitles_single_pass(self):
        # One filtergraph: drawbox (under) + subtitles (on top) — ONE encode.
        # Contract formula (docs/16 §7.1): W=1920 H=1080 BOTTOM offset 0 →
        # line 88%; w=round(1920*0.85)=1632; h=round(1080*0.12)=130;
        # x=round((1920-1632)/2)=144; y=round(1080*(88-6)/100)=886.
        # paddingPercent has no geometric effect in v1 (validated only).
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                mask=self.MASK,
            )

        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("drawbox=x=144:y=886:w=1632:h=130:t=fill:color=black@0.6", vf)
        self.assertIn("[m];[m]subtitles=", vf)
        self.assertIn("force_style", vf)
        self.assertEqual(1, sum(part == "-vf" for part in cmd))  # single pass

    def test_burn_mask_padding_has_no_geometric_effect_in_v1(self):
        # Padding is a validated semantic (0..10) reserved for the feasibility
        # estimate — the drawbox geometry must be byte-identical for any
        # padding value (contract formula, docs/16 §7.1).
        for padding in (0, 2, 10):
            mask = dict(self.MASK)
            mask["padding_percent"] = padding
            with patch("app.services.ffmpeg._run") as run, patch(
                "app.services.ffmpeg.get_video_height", return_value=1080
            ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
                burn_subtitles(
                    "source.mp4",
                    "subs/out.srt",
                    "render.mp4",
                    subtitle_format="srt",
                    mask=mask,
                )
            cmd = run.call_args.args[0]
            vf = cmd[cmd.index("-vf") + 1]
            self.assertIn("drawbox=x=144:y=886:w=1632:h=130:t=fill:color=black@0.6", vf, padding)

    def test_burn_ass_with_mask_chains_drawbox_under_fontsdir(self):
        # Mask applies to the styled burn too: drawbox under the ASS subtitles
        # filter; force_style must stay absent.
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.ass",
                "render.mp4",
                subtitle_format="ass",
                mask=self.MASK,
            )

        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("drawbox=", vf)
        self.assertIn("[m];[m]subtitles=", vf)
        self.assertIn("fontsdir=", vf)
        self.assertNotIn("force_style", vf)

    def test_burn_mask_geometry_follows_subtitle_anchor_and_offset(self):
        # CENTER + offset 10 → line 60%; the mask centers on that line.
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1000
        ), patch("app.services.ffmpeg.get_video_width", return_value=1000):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                position="CENTER",
                vertical_offset_percent=10,
                mask={
                    "enabled": True,
                    "anchor": "SUBTITLE",
                    "width_percent": 50,
                    "height_percent": 10,
                    "opacity_percent": 100,
                    "padding_percent": 0,
                },
            )

        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        # w=500 h=100 x=250 y=round(1000*(60-5)/100)=550
        self.assertIn("drawbox=x=250:y=550:w=500:h=100:t=fill:color=black@1", vf)

    def test_burn_mask_invalid_values_fail_closed(self):
        for field, value in (
            ("enabled", False),
            ("anchor", "TOP"),
            ("width_percent", 19),
            ("width_percent", 101),
            ("height_percent", 4),
            ("height_percent", 51),
            ("opacity_percent", -1),
            ("opacity_percent", 101),
            ("padding_percent", 11),
            ("style", "GRADIENT"),
            ("blur_radius", 1),
            ("blur_radius", 21),
            ("color", "red"),
            ("color", "#FF00"),
        ):
            mask = dict(self.MASK)
            mask[field] = value
            with patch("app.services.ffmpeg.get_video_height", return_value=1080), patch(
                "app.services.ffmpeg.get_video_width", return_value=1920
            ):
                with self.assertRaises(FFmpegError) as ctx:
                    burn_subtitles(
                        "source.mp4",
                        "subs/out.srt",
                        "render.mp4",
                        subtitle_format="srt",
                        mask=mask,
                    )
            self.assertEqual("INVALID_INPUT", ctx.exception.code, field)
            self.assertFalse(ctx.exception.retryable, field)

    # ─── PRESET-VIZ (docs/97 §19.16) mask style/color + background color ────

    def test_burn_solid_mask_with_explicit_color_uses_hex_in_drawbox(self):
        mask = {**self.MASK, "style": "SOLID", "color": "#336699"}
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                mask=mask,
            )
        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("drawbox=x=144:y=886:w=1632:h=130:t=fill:color=#336699@0.6", vf)
        self.assertIn("[m];[m]subtitles=", vf)
        self.assertEqual(1, sum(part == "-vf" for part in cmd))  # single pass

    def test_burn_blur_mask_builds_boxblur_region_chain_single_pass(self):
        # BLUR = split + boxblur (whole frame) + crop (mask region) + overlay
        # back — one filtergraph, one encode pass, geometry identical to SOLID.
        mask = {**self.MASK, "style": "BLUR", "blur_radius": 12}
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                mask=mask,
            )
        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("split=2[orig][b]", vf)
        self.assertIn("[b]boxblur=luma_radius=12:luma_power=1:chroma_radius=12:chroma_power=1[blurred]", vf)
        self.assertIn("[blurred]crop=w=1632:h=130:x=144:y=886[bc]", vf)
        self.assertIn("[orig][bc]overlay=x=144:y=886", vf)
        self.assertIn("[m];[m]subtitles=", vf)
        self.assertEqual(1, sum(part == "-vf" for part in cmd))  # single pass
        self.assertNotIn("drawbox", vf)

    def test_burn_blur_mask_radius_bounds_are_validated(self):
        for radius in (2, 20):
            mask = {**self.MASK, "style": "BLUR", "blur_radius": radius}
            with patch("app.services.ffmpeg._run") as run, patch(
                "app.services.ffmpeg.get_video_height", return_value=1080
            ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
                burn_subtitles(
                    "source.mp4",
                    "subs/out.srt",
                    "render.mp4",
                    subtitle_format="srt",
                    mask=mask,
                )
            cmd = run.call_args.args[0]
            vf = cmd[cmd.index("-vf") + 1]
            self.assertIn(f"boxblur=luma_radius={radius}:", vf)

    def test_burn_blur_mask_without_radius_fails_closed(self):
        mask = {**self.MASK, "style": "BLUR"}
        with patch("app.services.ffmpeg.get_video_height", return_value=1080), patch(
            "app.services.ffmpeg.get_video_width", return_value=1920
        ):
            with self.assertRaises(FFmpegError) as ctx:
                burn_subtitles(
                    "source.mp4",
                    "subs/out.srt",
                    "render.mp4",
                    subtitle_format="srt",
                    mask=mask,
                )
        self.assertEqual("INVALID_INPUT", ctx.exception.code)
        self.assertIn("blur_radius", str(ctx.exception))

    def test_burn_solid_mask_with_radius_fails_closed(self):
        mask = {**self.MASK, "style": "SOLID", "blur_radius": 8}
        with patch("app.services.ffmpeg.get_video_height", return_value=1080), patch(
            "app.services.ffmpeg.get_video_width", return_value=1920
        ):
            with self.assertRaises(FFmpegError) as ctx:
                burn_subtitles(
                    "source.mp4",
                    "subs/out.srt",
                    "render.mp4",
                    subtitle_format="srt",
                    mask=mask,
                )
        self.assertEqual("INVALID_INPUT", ctx.exception.code)
        self.assertIn("blur_radius", str(ctx.exception))

    def test_burn_background_color_maps_to_ass_backcolour(self):
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                background_box=True,
                background_color="#FF8800AA",
            )
        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        # #RRGGBBAA opacity maps to inverse ASS alpha: #FF8800AA → &H550088FF
        self.assertIn("BackColour=&H550088FF", vf)
        self.assertIn("BorderStyle=3", vf)
        # libass draws the visible box from OutlineColour (not BackColour) and
        # only when Outline > 0 — assert both so the box actually renders.
        self.assertIn("OutlineColour=&H550088FF", vf)
        self.assertIn("Outline=4", vf)

    def test_burn_background_color_absent_keeps_historical_backcolour(self):
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                background_box=True,
            )
        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("BackColour=&H80000000", vf)
        # Default black box must also render: OutlineColour set + Outline > 0.
        self.assertIn("OutlineColour=&H80000000", vf)
        self.assertIn("Outline=4", vf)

    def test_burn_background_color_malformed_fails_closed(self):
        for bad in ("#FF8800", "black", "FF8800AA", "#GG8800AA"):
            with patch("app.services.ffmpeg.get_video_height", return_value=1080), patch(
                "app.services.ffmpeg.get_video_width", return_value=1920
            ):
                with self.assertRaises(FFmpegError) as ctx:
                    burn_subtitles(
                        "source.mp4",
                        "subs/out.srt",
                        "render.mp4",
                        subtitle_format="srt",
                        background_color=bad,
                    )
            self.assertEqual("INVALID_INPUT", ctx.exception.code, bad)
            self.assertFalse(ctx.exception.retryable, bad)

    def test_burn_text_color_maps_to_ass_primarycolour(self):
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                text_color="#FF8800",
            )
        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        # #RRGGBB → ASS &HAABBGGRR with opaque alpha: #FF8800 → &H000088FF
        self.assertIn("PrimaryColour=&H000088FF", vf)

    def test_burn_text_color_accepts_rgba_and_is_opaque_by_default(self):
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
                text_color="#FF8800AA",
            )
        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        # #RRGGBBAA opacity maps to inverse ASS alpha: #FF8800AA → &H550088FF
        self.assertIn("PrimaryColour=&H550088FF", vf)

    def test_burn_text_color_absent_keeps_historical_primarycolour(self):
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4",
                "subs/out.srt",
                "render.mp4",
                subtitle_format="srt",
            )
        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertNotIn("PrimaryColour", vf)

    def test_burn_text_color_malformed_fails_closed(self):
        for bad in ("#FF880", "black", "FF8800", "#GG8800"):
            with patch("app.services.ffmpeg.get_video_height", return_value=1080), patch(
                "app.services.ffmpeg.get_video_width", return_value=1920
            ):
                with self.assertRaises(FFmpegError) as ctx:
                    burn_subtitles(
                        "source.mp4",
                        "subs/out.srt",
                        "render.mp4",
                        subtitle_format="srt",
                        text_color=bad,
                    )
            self.assertEqual("INVALID_INPUT", ctx.exception.code, bad)
            self.assertFalse(ctx.exception.retryable, bad)

    # ─── V2 presentation layers (docs/97 §19.17 §E) ──────────────────────

    def _capture_vf(self, **kwargs):
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
            burn_subtitles(
                "source.mp4", "subs/out.srt", "render.mp4",
                subtitle_format="srt", **kwargs,
            )
        cmd = run.call_args.args[0]
        return cmd[cmd.index("-vf") + 1]

    @staticmethod
    def _solid_layer(layer_id="cover", z_index=0, anchor="SUBTITLE",
                     width_percent=85, height_percent=12, color=None,
                     opacity_percent=60, x_percent=None, y_percent=None):
        geometry = {
            "width_percent": width_percent,
            "height_percent": height_percent,
        }
        if x_percent is not None:
            geometry["x_percent"] = x_percent
        if y_percent is not None:
            geometry["y_percent"] = y_percent
        return {
            "id": layer_id,
            "type": "SOLID",
            "enabled": True,
            "z_index": z_index,
            "anchor": anchor,
            "geometry": geometry,
            "style": {"color": color, "opacity_percent": opacity_percent},
        }

    @staticmethod
    def _blur_layer(layer_id="cover", z_index=0, anchor="SUBTITLE",
                    width_percent=85, height_percent=12, blur_radius=12):
        return {
            "id": layer_id,
            "type": "BLUR",
            "enabled": True,
            "z_index": z_index,
            "anchor": anchor,
            "geometry": {
                "width_percent": width_percent,
                "height_percent": height_percent,
            },
            "style": {"blur_radius": blur_radius},
        }

    def test_single_solid_layer_is_byte_identical_to_v1_mask(self):
        # Mục K regression gate: the v1 mask payload and the equivalent v2
        # single-layer payload produce the SAME filtergraph, byte for byte —
        # if they diverge, the v1 path is the authority and v2 must be fixed.
        vf_mask = self._capture_vf(mask=self.MASK)
        vf_layer = self._capture_vf(layers=[self._solid_layer()])
        self.assertEqual(vf_mask, vf_layer)
        self.assertIn("drawbox=x=144:y=886:w=1632:h=130:t=fill:color=black@0.6[m];[m]subtitles=", vf_layer)

    def test_single_blur_layer_is_byte_identical_to_v1_mask(self):
        blur_mask = {**self.MASK, "style": "BLUR", "blur_radius": 12}
        vf_mask = self._capture_vf(mask=blur_mask)
        vf_layer = self._capture_vf(layers=[self._blur_layer()])
        self.assertEqual(vf_mask, vf_layer)
        self.assertIn("[orig][bc]overlay=x=144:y=886[m];[m]subtitles=", vf_layer)
        self.assertNotIn("drawbox", vf_layer)

    def test_layers_render_in_zindex_then_id_order_under_subtitles(self):
        # zIndex ASC orders the chain (bottom-most first); subtitles stay on top.
        bottom = self._solid_layer(layer_id="alpha", z_index=1, anchor="BOTTOM",
                                   width_percent=30, height_percent=8,
                                   opacity_percent=80)
        top = self._solid_layer(layer_id="zeta", z_index=5, anchor="TOP",
                                width_percent=50, height_percent=10,
                                opacity_percent=40)
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1000
        ), patch("app.services.ffmpeg.get_video_width", return_value=1000):
            burn_subtitles(
                "source.mp4", "subs/out.srt", "render.mp4",
                subtitle_format="srt", layers=[top, bottom],
            )
        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        # W=H=1000: alpha(BOTTOM,88%) → x=350 y=840 w=300 h=80;
        # zeta(TOP,8%) → x=250 y=30 w=500 h=100.
        self.assertTrue(vf.startswith(
            "drawbox=x=350:y=840:w=300:h=80:t=fill:color=black@0.8[v1]"
            ";[v1]drawbox=x=250:y=30:w=500:h=100:t=fill:color=black@0.4"
        ), vf)
        self.assertIn("[m];[m]subtitles=", vf)
        self.assertEqual(1, sum(part == "-vf" for part in cmd))  # single pass

    def test_equal_zindex_ties_break_by_id_ascending(self):
        first = self._solid_layer(layer_id="beta", z_index=2, anchor="TOP",
                                  width_percent=20, height_percent=5,
                                  color="#222222")
        second = self._solid_layer(layer_id="alpha", z_index=2, anchor="TOP",
                                   width_percent=20, height_percent=5,
                                   color="#111111")
        vf = self._capture_vf(layers=[first, second])
        # Identical geometry — only id order decides: alpha (#111111) is drawn
        # BEFORE beta (#222222).
        self.assertLess(vf.index("#111111"), vf.index("#222222"))

    def test_top_center_bottom_anchors_are_independent_of_subtitle_offset(self):
        # F-09: fixed anchors ignore the subtitle vertical offset entirely —
        # the text moves to 95% (BOTTOM base 88 + offset 20 clamped) while the
        # anchored overlays stay at their own scanlines.
        layers = [
            self._solid_layer(layer_id="at-top", z_index=0, anchor="TOP",
                              width_percent=50, height_percent=10,
                              color="#101010"),
            self._solid_layer(layer_id="at-center", z_index=1, anchor="CENTER",
                              width_percent=50, height_percent=10,
                              color="#202020"),
            self._solid_layer(layer_id="at-bottom", z_index=2, anchor="BOTTOM",
                              width_percent=50, height_percent=10,
                              color="#303030"),
        ]
        with patch("app.services.ffmpeg._run") as run, patch(
            "app.services.ffmpeg.get_video_height", return_value=1000
        ), patch("app.services.ffmpeg.get_video_width", return_value=1000):
            burn_subtitles(
                "source.mp4", "subs/out.srt", "render.mp4",
                subtitle_format="srt",
                position="BOTTOM", vertical_offset_percent=20,
                layers=layers,
            )
        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        # h=100 → y = round(1000*(line-5)/100): TOP 8→30, CENTER 50→450,
        # BOTTOM 88→830 — none shifted by the +20 offset applied to the text.
        self.assertIn("drawbox=x=250:y=30:w=500:h=100:t=fill:color=#101010@0.6", vf)
        self.assertIn("drawbox=x=250:y=450:w=500:h=100:t=fill:color=#202020@0.6", vf)
        self.assertIn("drawbox=x=250:y=830:w=500:h=100:t=fill:color=#303030@0.6", vf)
        # Text itself sits at the clamped 95% line (MarginV=50).
        self.assertIn("MarginV=50", vf)

    def test_subtitle_anchor_tracks_effective_text_line_with_offset(self):
        # anchor=SUBTITLE centers on the SAME effective line as the text
        # (CENTER + offset 10 → line 60%). Capture frame is 1920×1080:
        # w=960 h=108 x=480 y=round(1080*(60-5)/100)=594.
        vf = self._capture_vf(
            position="CENTER", vertical_offset_percent=10,
            layers=[self._solid_layer(width_percent=50, height_percent=10,
                                      opacity_percent=100)],
        )
        self.assertIn("drawbox=x=480:y=594:w=960:h=108:t=fill:color=black@1", vf)

    def test_layer_free_coordinates_override_center_and_anchor(self):
        # Center (25%, 70%), size (20%, 10%) on 1920x1080:
        # x=1920*(25-10)%=288, y=1080*(70-5)%=702.
        vf = self._capture_vf(
            layers=[self._solid_layer(
                anchor="TOP",
                width_percent=20,
                height_percent=10,
                opacity_percent=100,
                x_percent=25,
                y_percent=70,
            )],
        )
        self.assertIn(
            "drawbox=x=288:y=702:w=384:h=108:t=fill:color=black@1",
            vf,
        )

    def test_layers_take_precedence_and_ignore_the_mask_field(self):
        # Wire precedence: non-empty layers are authoritative — a MALFORMED
        # mask alongside them must neither raise nor reach the filtergraph
        # (no double-burn).
        bad_mask = {**self.MASK, "width_percent": 19}
        vf = self._capture_vf(mask=bad_mask, layers=[self._solid_layer()])
        self.assertEqual(1, vf.count("drawbox"))
        self.assertIn("drawbox=x=144:y=886:w=1632:h=130:t=fill:color=black@0.6", vf)

    def test_empty_layers_list_falls_back_to_v1_mask_path(self):
        vf_empty_layers = self._capture_vf(mask=self.MASK, layers=[])
        vf_mask_only = self._capture_vf(mask=self.MASK)
        self.assertEqual(vf_mask_only, vf_empty_layers)

    def test_invalid_layer_payloads_fail_closed(self):
        good_solid = self._solid_layer()
        good_blur = self._blur_layer()
        bad_solids = []
        for mutation in (
            {"enabled": False},
            {"type": "GRADIENT"},
            {"anchor": "SIDE"},
            {"z_index": "0"},
            {"id": "Cover"},
            {"id": "a" * 65},
            {"geometry": {"width_percent": 19, "height_percent": 12}},
            {"geometry": {"width_percent": 85, "height_percent": 51}},
            {"style": {}},
            {"style": {"opacity_percent": 60, "blur_radius": 8}},
            {"style": {"opacity_percent": 60, "color": "red"}},
        ):
            bad = dict(good_solid)
            bad.update(mutation)
            bad_solids.append(bad)
        bad_blur_no_radius = dict(good_blur)
        bad_blur_no_radius["style"] = {}
        bad_blur_with_color = dict(good_blur)
        bad_blur_with_color["style"] = {"color": "#112233"}
        five_layers = [self._solid_layer(layer_id=f"l{i}") for i in range(5)]
        for payload in (*bad_solids, bad_blur_no_radius, bad_blur_with_color,
                        five_layers):
            with patch("app.services.ffmpeg.get_video_height", return_value=1080), \
                 patch("app.services.ffmpeg.get_video_width", return_value=1920):
                with self.assertRaises(FFmpegError) as ctx:
                    burn_subtitles(
                        "source.mp4", "subs/out.srt", "render.mp4",
                        subtitle_format="srt", layers=payload,
                    )
            self.assertEqual("INVALID_INPUT", ctx.exception.code, payload)
            self.assertFalse(ctx.exception.retryable, payload)

    # ─── V2 outline subset on the legacy burn path (Mục F) ───────────────

    def test_ring_outline_absent_keeps_historical_style_bytes(self):
        vf = self._capture_vf(background_box=False)
        self.assertIn("BorderStyle=1,Outline=2,Shadow=0", vf)
        self.assertNotIn("OutlineColour", vf)

    def test_ring_outline_present_overrides_width_and_colour(self):
        vf = self._capture_vf(background_box=False,
                              outline_width=3, outline_color="#ABCDEF")
        # #ABCDEF → BGR EF CD AB, opaque alpha 00.
        self.assertIn("BorderStyle=1,Outline=3,Shadow=0,OutlineColour=&H00EFCDAB", vf)
        self.assertNotIn("Outline=2,", vf)

    def test_ring_outline_partial_fields_keep_individual_defaults(self):
        width_only = self._capture_vf(background_box=False, outline_width=5)
        self.assertIn("BorderStyle=1,Outline=5,Shadow=0,OutlineColour=&H00000000", width_only)
        colour_only = self._capture_vf(background_box=False,
                                       outline_color="#ABCDEF")
        self.assertIn("BorderStyle=1,Outline=2,Shadow=0,OutlineColour=&H00EFCDAB", colour_only)

    def test_ring_outline_bounds_fail_closed(self):
        for kwargs in (
            {"outline_width": -1},
            {"outline_width": 9},
            {"outline_color": "red"},
            {"outline_color": "#ABCDEFG"},
        ):
            with patch("app.services.ffmpeg.get_video_height", return_value=1080), \
                 patch("app.services.ffmpeg.get_video_width", return_value=1920):
                with self.assertRaises(FFmpegError) as ctx:
                    burn_subtitles(
                        "source.mp4", "subs/out.srt", "render.mp4",
                        subtitle_format="srt", background_box=False, **kwargs,
                    )
            self.assertEqual("INVALID_INPUT", ctx.exception.code, kwargs)
            self.assertFalse(ctx.exception.retryable, kwargs)

    def test_box_mode_wins_over_outline_and_warns(self):
        # Defensive XOR: Spring 422s box+outline; a direct dispatch keeps the
        # box authoritative (background colour + extent 4) and logs a warning.
        with self.assertLogs("app.services.ffmpeg", level="WARNING") as captured:
            vf = self._capture_vf(
                background_box=True, background_color="#FF8800AA",
                outline_width=3, outline_color="#ABCDEF",
            )
        self.assertIn("BorderStyle=3,Outline=4,Shadow=0,OutlineColour=&H550088FF", vf)
        self.assertNotIn("Outline=3", vf)
        self.assertNotIn("&H00EFCDAB", vf)
        self.assertTrue(any("outline_width/outline_color ignored" in line
                            for line in captured.output))

    def test_dual_box_outline_bakes_styles_in_ass_and_keeps_force_style_placement_only(self):
        # 2026-09 dual-event: converted ASS carries Box (yellow) + Default
        # (black text, white ring); force_style keeps Alignment/MarginV/Bold
        # only so it cannot override either baked style. Positioning identical
        # to the single path (same \pos + MarginV).
        with TemporaryDirectory() as d:
            srt = os.path.join(d, "sub.srt")
            with open(srt, "w", encoding="utf-8") as fh:
                fh.write("1\n00:00:00,500 --> 00:00:02,500\nHello world\n")
            ass = _srt_vtt_to_ass(
                srt, "srt", 1920, 1080, alignment=2, margin_v=130,
                background_box=True, background_color="#FFFF00FF",
                text_color="#000000", outline_width=2, outline_color="#FFFFFF",
            )
            try:
                content = open(ass, "r", encoding="utf-8").read()
            finally:
                os.remove(ass)
        # Yellow opaque: alpha FF → ASS 00, BGR 00FFFF.
        self.assertIn(
            "Style: Box,Arial,44,&HFF000000,&H000000FF,&H0000FFFF,&H0000FFFF,"
            "0,0,0,0,100,100,0,0,3,4,0,2,10,10,130,1",
            content,
        )
        self.assertIn(
            "Style: Default,Arial,44,&H00000000,&H000000FF,&H00FFFFFF,&H80000000,"
            "0,0,0,0,100,100,0,0,1,2,0,2,10,10,130,1",
            content,
        )
        self.assertIn(
            "Dialogue: 0,0:00:00.50,0:00:02.50,Box,,0,0,130,,"
            "{\\an2\\pos(960,950)}Hello world",
            content,
        )
        self.assertIn(
            "Dialogue: 1,0:00:00.50,0:00:02.50,Default,,0,0,130,,"
            "{\\an2\\pos(960,950)}Hello world",
            content,
        )

    def test_dual_box_outline_force_style_has_no_box_or_primary(self):
        # Converted path: force_style must not carry box/PrimaryColour or it
        # would override the baked dual styles; single path keeps them.
        with TemporaryDirectory() as temp_dir:
            subtitle_path = os.path.join(temp_dir, "sub.srt")
            with open(subtitle_path, "w", encoding="utf-8") as fh:
                fh.write("1\n00:00:00,500 --> 00:00:02,500\nHello world\n")
            with patch("app.services.ffmpeg._run") as run, patch(
                "app.services.ffmpeg.get_video_height", return_value=1080
            ), patch("app.services.ffmpeg.get_video_width", return_value=1920):
                burn_subtitles(
                    "source.mp4", subtitle_path, "render.mp4",
                    subtitle_format="srt", background_box=True,
                    background_color="#FFFF00FF", text_color="#000000",
                    bold=True, outline_width=2, outline_color="#FFFFFF",
                )
            vf_dual = run.call_args.args[0]
            vf_dual = vf_dual[vf_dual.index("-vf") + 1]
        self.assertIn("Alignment=", vf_dual)
        self.assertIn("MarginV=", vf_dual)
        self.assertIn("Bold=-1", vf_dual)
        self.assertNotIn("BorderStyle=", vf_dual)
        self.assertNotIn("PrimaryColour=", vf_dual)
        self.assertNotIn("OutlineColour=", vf_dual)
        # No cover overlay: no mask/layers were passed.
        self.assertNotIn("drawbox", vf_dual)
        self.assertNotIn("boxblur", vf_dual)

    def test_single_style_path_stays_byte_identical_without_outline(self):
        # No outline → historical single style, \pos unchanged.
        with TemporaryDirectory() as d:
            srt = os.path.join(d, "sub.srt")
            with open(srt, "w", encoding="utf-8") as fh:
                fh.write("1\n00:00:00,500 --> 00:00:02,500\nHello world\n")
            ass = _srt_vtt_to_ass(srt, "srt", 1920, 1080, alignment=2, margin_v=130)
            try:
                content = open(ass, "r", encoding="utf-8").read()
            finally:
                os.remove(ass)
        self.assertIn(
            "Style: Default,Arial,44,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
            "0,0,0,0,100,100,0,0,3,0,0,2,10,10,130,1",
            content,
        )
        self.assertNotIn("Style: Box,", content)

    def test_srt_vtt_to_ass_pins_playres_to_video_frame(self):
        # PRESET-VIZ (docs/97 §19.16): the legacy SRT burn path mis-scales
        # MarginV because libass reads SRT with a fixed PlayResY of 288. The
        # converter must pin PlayResX/Y to the actual video frame so the
        # force_style MarginV (computed in video-pixel space) maps 1:1 on screen.
        with TemporaryDirectory() as d:
            srt = os.path.join(d, "sub.srt")
            with open(srt, "w", encoding="utf-8") as fh:
                fh.write("1\n00:00:00,500 --> 00:00:02,500\nHello world\n")
            ass = _srt_vtt_to_ass(
                srt, "srt", 1920, 1080, alignment=8, margin_v=659
            )
            try:
                content = open(ass, "r", encoding="utf-8").read()
            finally:
                os.remove(ass)
        self.assertIn("PlayResX: 1920", content)
        self.assertIn("PlayResY: 1080", content)
        # Placement must be baked into the generated style. libass ignores
        # MarginV supplied only through force_style for this converted ASS path.
        self.assertIn(",8,10,10,659,1", content)
        self.assertIn(
            "Dialogue: 0,0:00:00.50,0:00:02.50,Default,,0,0,659,,"
            "{\\an8\\pos(960,659)}Hello world",
            content,
        )

    def test_existing_srt_composes_reframe_before_layers_and_styled_subtitles(self):
        with TemporaryDirectory() as temp_dir:
            subtitle_path = os.path.join(temp_dir, "sub.srt")
            with open(subtitle_path, "w", encoding="utf-8") as fh:
                fh.write("1\n00:00:00,500 --> 00:00:02,500\nHello world\n")
            with patch("app.services.ffmpeg._run") as run, patch(
                "app.services.ffmpeg.get_video_height", return_value=1080
            ), patch(
                "app.services.ffmpeg.get_video_width", return_value=1920
            ):
                burn_subtitles(
                    "source.mp4",
                    subtitle_path,
                    "render.mp4",
                    subtitle_format="srt",
                    position="BOTTOM",
                    background_box=True,
                    background_color="#112233CC",
                    layers=[self._solid_layer()],
                    output_aspect_ratio="9:16",
                )

        cmd = run.call_args.args[0]
        vf = cmd[cmd.index("-vf") + 1]
        self.assertTrue(vf.startswith("split=2[rbg][rfg]"))
        self.assertLess(vf.index("overlay=(W-w)/2:(H-h)/2"), vf.index("drawbox="))
        self.assertLess(vf.index("drawbox="), vf.index("subtitles="))
        self.assertIn("BorderStyle=3", vf)
        self.assertIn("Outline=4", vf)
        self.assertIn("OutlineColour=&H33332211", vf)

    def test_vtt_vtt_to_ass_converts_then_pins_playres(self):
        with TemporaryDirectory() as d:
            vtt = os.path.join(d, "sub.vtt")
            with open(vtt, "w", encoding="utf-8") as fh:
                fh.write("WEBVTT\n\n00:00:00.500 --> 00:00:02.500\nHello VTT\n")
            ass = _srt_vtt_to_ass(vtt, "vtt", 1280, 720)
            try:
                content = open(ass, "r", encoding="utf-8").read()
            finally:
                os.remove(ass)
        self.assertIn("PlayResX: 1280", content)
        self.assertIn("PlayResY: 720", content)
        self.assertIn("Hello VTT", content)

    def test_build_dubbed_audio_collects_segment_warning(self):
        warning = {
            "code": "AUDIO_TRUNCATED",
            "exceeded_ms": 1_000,
            "segment_id": "seg-42",
        }
        storage = Mock()
        storage_module = ModuleType("app.services.storage")
        storage_module.get_storage = Mock(return_value=storage)
        with TemporaryDirectory() as temp_dir:
            with patch.dict(sys.modules, {"app.services.storage": storage_module}), patch(
                "app.services.ffmpeg.fit_dub_audio",
                return_value=("fitted.wav", warning),
            ), patch(
                "app.services.ffmpeg.AudioSegment.from_file",
                return_value=AudioSegment.silent(duration=2_000),
            ):
                output_path, warnings = build_dubbed_audio(
                    "source.mp4",
                    [CutRange(start_ms=0, end_ms=2_000)],
                    [SegmentAudio("seg-42", "tts/seg-42.wav", 0, 2_000)],
                    temp_dir,
                )

        storage.download.assert_called_once()
        self.assertEqual([warning], warnings)
        self.assertTrue(output_path.endswith("final_audio.wav"))

if __name__ == "__main__":
    unittest.main()
