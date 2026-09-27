"""OUTPUT-ASPECT (docs/97 §19.19) — reframe (blur-pad) worker contract tests.

Covers: semantic target-dim math, the blur-pad filter string (unlabeled output
so the cover chain links deterministically), frame_size-driven cover geometry,
the legacy scanline/PlayRes math against the TARGET frame, and the capability
advertisement.
"""
import unittest
from unittest.mock import patch

from app.core.capability import SUPPORTED_RENDER_FEATURES
from app.services.ffmpeg import (
    FFmpegError,
    _build_layer_filters,
    _build_mask_filter,
    _build_reframe_filter,
    _classify_ffmpeg_error,
    _compose_vf,
    _reframe_target_dims,
    _validate_output_aspect_ratio,
)

MASK = {
    "enabled": True,
    "anchor": "SUBTITLE",
    "width_percent": 50,
    "height_percent": 10,
    "opacity_percent": 100,
    "padding_percent": 0,
    "style": "SOLID",
    "blur_radius": None,
    "color": "#000000",
}


class ValidateOutputAspectRatioTest(unittest.TestCase):
    def test_none_and_original_are_identity(self):
        self.assertIsNone(_validate_output_aspect_ratio(None))
        self.assertIsNone(_validate_output_aspect_ratio("ORIGINAL"))
        self.assertIsNone(_validate_output_aspect_ratio("original"))

    def test_semantic_frames_normalize_uppercase(self):
        self.assertEqual(_validate_output_aspect_ratio("9:16"), "9:16")
        self.assertEqual(_validate_output_aspect_ratio("16:9"), "16:9")

    def test_invalid_value_fails_closed_non_retryable(self):
        with self.assertRaises(FFmpegError) as ctx:
            _validate_output_aspect_ratio("21:9")
        self.assertFalse(ctx.exception.retryable)


class ReframeTargetDimsTest(unittest.TestCase):
    def test_16x9_source_to_9x16_keeps_height_narrows_width_even(self):
        # 1920x1080 → W = round(1080 * 9/16) = 608 (even), H stays 1080.
        self.assertEqual(_reframe_target_dims(1920, 1080, "9:16"), (608, 1080))

    def test_9x16_source_to_16x9_keeps_width_and_derives_height(self):
        # 1080x2400 (9:20) → 16:9: wider target keeps W=1080,
        # H = round(1080 / (16/9)) = 608 — the frame never exceeds the source.
        self.assertEqual(_reframe_target_dims(1080, 2400, "16:9"), (1080, 608))

    def test_square_target_from_landscape_keeps_height(self):
        # 1920x1080 → W = 1080 (already even), H = 1080.
        self.assertEqual(_reframe_target_dims(1920, 1080, "1:1"), (1080, 1080))

    def test_identity_when_ratio_already_matches(self):
        self.assertIsNone(_reframe_target_dims(1920, 1080, "16:9"))
        self.assertIsNone(_reframe_target_dims(1080, 1920, "9:16"))
        self.assertIsNone(_reframe_target_dims(1920, 1080, None))
        self.assertIsNone(_reframe_target_dims(1920, 1080, "ORIGINAL"))

    def test_four_three_target(self):
        # 1920x1080 → W = round(1080 * 4/3) = 1440 (even), H = 1080.
        self.assertEqual(_reframe_target_dims(1920, 1080, "4:3"), (1440, 1080))

    def test_odd_computed_dim_snaps_even(self):
        # 1081x1920 → 1:1: wider target keeps W (1081 → even 1080),
        # H = round(1080 / 1) = 1080.
        self.assertEqual(_reframe_target_dims(1081, 1920, "1:1"), (1080, 1080))


class ReframeFilterTest(unittest.TestCase):
    def test_identity_produces_no_filter(self):
        self.assertIsNone(_build_reframe_filter(1920, 1080, "16:9"))
        self.assertIsNone(_build_reframe_filter(1920, 1080, None))

    def test_blur_pad_filter_targets_even_dims_and_ends_unlabeled(self):
        graph = _build_reframe_filter(1920, 1080, "9:16")
        self.assertIsNotNone(graph)
        # Background: cover-scale + center-crop + boxblur; foreground: fit-scale;
        # centered overlay. The final output stays UNLABELED.
        self.assertIn("split=2[rbg][rfg]", graph)
        self.assertIn(
            "[rbg]scale=608:1080:force_original_aspect_ratio=increase,crop=608:1080,",
            graph,
        )
        self.assertIn("boxblur=luma_radius=24:luma_power=2[bg]", graph)
        self.assertIn("[rfg]scale=608:1080:force_original_aspect_ratio=decrease[fg]", graph)
        self.assertIn("[bg][fg]overlay=(W-w)/2:(H-h)/2", graph)
        self.assertFalse(graph.rstrip().endswith("]"))

    def test_compose_vf_joins_prefix_and_chain(self):
        self.assertEqual(_compose_vf(None, "subtitles=x"), "subtitles=x")
        self.assertEqual(_compose_vf("split=2[a][b];…", "subtitles=x"), "split=2[a][b];…,subtitles=x")


class CoverGeometryOnTargetFrameTest(unittest.TestCase):
    def test_mask_geometry_uses_target_dims_not_source_probe(self):
        with patch("app.services.ffmpeg.get_video_width", return_value=1920), patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ):
            graph = _build_mask_filter(
                MASK, "video.mp4", "BOTTOM", 0, frame_size=(608, 1080)
            )
        # maskW = round(608 * 50/100) = 304; x = (608-304)/2 = 152;
        # line = 88 → y = round(1080 * (88 - 5) / 100) = 896.
        self.assertIn("drawbox=x=152:y=896:w=304:h=108:", graph)

    def test_layer_geometry_uses_target_dims(self):
        layer = {
            "id": "cover-1",
            "type": "SOLID",
            "enabled": True,
            "z_index": 0,
            "anchor": "TOP",
            "geometry": {"width_percent": 100, "height_percent": 10},
            "style": {"color": "#000000", "opacity_percent": 100},
        }
        with patch("app.services.ffmpeg.get_video_width", return_value=1920), patch(
            "app.services.ffmpeg.get_video_height", return_value=1080
        ):
            graph = _build_layer_filters(
                [layer], "video.mp4", "BOTTOM", 0, frame_size=(608, 1080)
            )
        # layerW = 608, layerH = round(1080 * 10/100) = 108; anchor TOP →
        # line 8 → y = round(1080 * (8 - 5) / 100) = 32.
        self.assertIn("drawbox=x=0:y=32:w=608:h=108:t=fill:color=#000000@1", graph)


class CapabilityAdvertisementTest(unittest.TestCase):
    def test_worker_advertises_render_output_aspect(self):
        self.assertIn("RENDER_OUTPUT_ASPECT", SUPPORTED_RENDER_FEATURES)


class ClassifyFfmpegErrorTest(unittest.TestCase):
    def test_banner_codec_option_does_not_trigger_codec_unsupported(self):
        stderr = (
            "ffmpeg version 7.1.5 Copyright (c) 2000-2026 the FFmpeg developers\n"
            "  configuration: --prefix=/usr --enable-libcodec2 --enable-libx264\n"
            "  libavutil      59. 39.100 / 59. 39.100\n"
            "  libavcodec     61. 19.101 / 61. 19.101\n"
            "  libpostproc    58.  3.100 / 58.  3.100\n"
            "Simple filtergraph ... had 2 input(s) and 2 output(s).\n"
            "Error opening output files: Invalid argument\n"
        )
        code, retryable = _classify_ffmpeg_error(stderr)
        self.assertEqual("INVALID_INPUT", code)
        self.assertFalse(retryable)

    def test_actual_codec_error_is_classified_as_codec_unsupported(self):
        stderr = (
            "ffmpeg version 7.1.5 Copyright (c) 2000-2026 the FFmpeg developers\n"
            "  configuration: --prefix=/usr --enable-libcodec2\n"
            "  libavcodec     61. 19.101 / 61. 19.101\n"
            "Unknown encoder 'libnonexistent'\n"
        )
        code, retryable = _classify_ffmpeg_error(stderr)
        self.assertEqual("CODEC_UNSUPPORTED", code)
        self.assertFalse(retryable)


if __name__ == "__main__":
    unittest.main()
