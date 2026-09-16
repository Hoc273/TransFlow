"""Render technical validation tests (Phase A2.2a — docs/93 v7, Q-M-TTS-15)."""

import unittest
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, Mock, patch

from app.api.render import RenderRequest, SubtitleTrackRequest, process_render
from app.services.callback import send_complete
from app.services.ffmpeg import FFmpegError
from app.services.render_validation import (
    AudioStreamValidator,
    CheckStatus,
    DurationValidator,
    RenderValidationRunner,
    RenderValidationReport,
    SubtitleStreamValidator,
    ValidationCheck,
    ValidationContext,
    ValidationSeverity,
    VideoStreamValidator,
    count_subtitle_cues,
    first_error_check,
)


def ctx(**overrides) -> ValidationContext:
    values = {
        "video_path": "/tmp/out/final.mp4",
        "subtitle_path": "/tmp/out/final.srt",
        "subtitle_format": "srt",
        "subtitle_mode": "SOFT_SUB",
        "expected_duration_ms": 1_000,
        "tolerance_ms": 500,
        "tolerance_pct": 2.0,
    }
    values.update(overrides)
    return ValidationContext(**values)


class DurationValidatorTest(unittest.TestCase):
    def test_within_ms_tolerance_passes(self):
        with patch("app.services.render_validation.get_duration", return_value=1.3):
            check = DurationValidator().validate(ctx())
        self.assertIs(CheckStatus.PASS, check.status)
        self.assertIs(ValidationSeverity.ERROR, check.severity)
        self.assertEqual(1_300, check.actual)
        self.assertEqual(500, check.tolerance)

    def test_exact_boundary_passes(self):
        with patch("app.services.render_validation.get_duration", return_value=1.5):
            check = DurationValidator().validate(ctx())
        self.assertIs(CheckStatus.PASS, check.status)

    def test_beyond_tolerance_fails(self):
        with patch("app.services.render_validation.get_duration", return_value=1.501):
            check = DurationValidator().validate(ctx())
        self.assertIs(CheckStatus.FAIL, check.status)
        self.assertIn("1501", check.message)
        self.assertNotIn("/tmp", check.message)
        self.assertNotIn("stderr", check.message)

    def test_pct_tolerance_used_when_larger_than_ms(self):
        # expected 100_000 ms: 2% = 2_000 ms > 500 ms → tolerance 2_000.
        with patch("app.services.render_validation.get_duration", return_value=102.0):
            check = DurationValidator().validate(
                ctx(expected_duration_ms=100_000, tolerance_ms=500, tolerance_pct=2.0)
            )
        self.assertIs(CheckStatus.PASS, check.status)
        self.assertEqual(2_000, check.tolerance)

    def test_probe_failure_is_error_fail(self):
        with patch(
            "app.services.render_validation.get_duration",
            side_effect=FFmpegError("boom", "RENDER_TIMEOUT", retryable=False),
        ):
            check = DurationValidator().validate(ctx())
        self.assertIs(CheckStatus.FAIL, check.status)
        self.assertIs(ValidationSeverity.ERROR, check.severity)
        self.assertIsNone(check.actual)


class StreamValidatorTest(unittest.TestCase):
    def test_missing_audio_fails(self):
        with patch("app.services.render_validation.get_stream_types", return_value=["video", "subtitle"]):
            check = AudioStreamValidator().validate(ctx())
        self.assertIs(CheckStatus.FAIL, check.status)
        self.assertIs(ValidationSeverity.ERROR, check.severity)
        self.assertEqual("missing", check.actual)

    def test_audio_present_passes(self):
        with patch("app.services.render_validation.get_stream_types", return_value=["video", "audio"]):
            check = AudioStreamValidator().validate(ctx())
        self.assertIs(CheckStatus.PASS, check.status)

    def test_missing_video_stream_fails(self):
        with patch("app.services.render_validation.get_stream_types", return_value=["audio", "subtitle"]):
            check = VideoStreamValidator().validate(ctx())
        self.assertIs(CheckStatus.FAIL, check.status)
        self.assertIs(ValidationSeverity.ERROR, check.severity)

    def test_soft_sub_missing_subtitle_stream_fails(self):
        with patch("app.services.render_validation.get_stream_types", return_value=["video", "audio"]):
            check = SubtitleStreamValidator().validate(ctx(subtitle_mode="SOFT_SUB"))
        self.assertIs(CheckStatus.FAIL, check.status)
        self.assertIs(ValidationSeverity.ERROR, check.severity)

    def test_soft_sub_subtitle_present_passes(self):
        with patch(
            "app.services.render_validation.get_stream_types",
            return_value=["video", "audio", "subtitle"],
        ):
            check = SubtitleStreamValidator().validate(ctx(subtitle_mode="SOFT_SUB"))
        self.assertIs(CheckStatus.PASS, check.status)

    def test_hard_sub_empty_cues_warns_but_does_not_fail(self):
        with TemporaryDirectory() as tmp:
            subtitle_path = f"{tmp}/empty.srt"
            with open(subtitle_path, "w", encoding="utf-8") as handle:
                handle.write("")
            check = SubtitleStreamValidator().validate(
                ctx(subtitle_path=subtitle_path, subtitle_mode="HARD_SUB")
            )
        self.assertIs(CheckStatus.FAIL, check.status)
        self.assertIs(ValidationSeverity.WARNING, check.severity)

    def test_hard_sub_with_cues_passes(self):
        with TemporaryDirectory() as tmp:
            subtitle_path = f"{tmp}/cues.srt"
            with open(subtitle_path, "w", encoding="utf-8") as handle:
                handle.write("1\n00:00:01,000 --> 00:00:04,000\nHello\n")
            check = SubtitleStreamValidator().validate(
                ctx(subtitle_path=subtitle_path, subtitle_mode="HARD_SUB")
            )
        self.assertIs(CheckStatus.PASS, check.status)
        self.assertIs(ValidationSeverity.WARNING, check.severity)


class CueCounterTest(unittest.TestCase):
    def test_ass_counts_dialogue_lines_only(self):
        with TemporaryDirectory() as tmp:
            subtitle_path = f"{tmp}/style.ass"
            with open(subtitle_path, "w", encoding="utf-8") as handle:
                handle.write(
                    "[Script Info]\n"
                    "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello\n"
                    "Comment: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Nope\n"
                    "Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,World\n"
                )
            self.assertEqual(2, count_subtitle_cues(subtitle_path, "ass"))

    def test_srt_counts_timing_lines(self):
        with TemporaryDirectory() as tmp:
            subtitle_path = f"{tmp}/sub.srt"
            with open(subtitle_path, "w", encoding="utf-8") as handle:
                handle.write("1\n00:00:01,000 --> 00:00:04,000\nHello\n\n2\n00:00:05,000 --> 00:00:08,000\nWorld\n")
            self.assertEqual(2, count_subtitle_cues(subtitle_path, "srt"))

    def test_missing_file_returns_zero(self):
        self.assertEqual(0, count_subtitle_cues("/nonexistent/sub.srt", "srt"))
        self.assertEqual(0, count_subtitle_cues(None, "srt"))


class ReportTest(unittest.TestCase):
    def test_warning_only_does_not_fail_report(self):
        report = RenderValidationReport(checks=(ValidationCheck(
            "subtitle_stream", ValidationSeverity.WARNING, CheckStatus.FAIL, 0, ">=1 cue"
        ),))
        self.assertTrue(report.passed)

    def test_error_fail_fails_report(self):
        report = RenderValidationReport(checks=(ValidationCheck(
            "audio_stream", ValidationSeverity.ERROR, CheckStatus.FAIL, "missing", "audio stream"
        ),))
        self.assertFalse(report.passed)

    def test_all_validators_aggregate(self):
        with patch("app.services.render_validation.get_duration", return_value=1.0), patch(
            "app.services.render_validation.get_stream_types",
            return_value=["video", "audio", "subtitle"],
        ):
            report = RenderValidationRunner().run(ctx())
        self.assertEqual(4, len(report.checks))
        self.assertEqual(
            ["duration", "audio_stream", "video_stream", "subtitle_stream"],
            [check.id for check in report.checks],
        )
        self.assertTrue(report.passed)
        self.assertEqual(1_000, report.metrics["expected_duration_ms"])
        self.assertEqual(1_000, report.metrics["actual_duration_ms"])

    def test_to_payload_always_seven_fields_in_order(self):
        check = ValidationCheck(
            "duration", ValidationSeverity.ERROR, CheckStatus.PASS,
            actual=1_000, expected=1_000, tolerance=500, message="ok",
        )
        self.assertEqual(
            ["id", "severity", "status", "actual", "expected", "tolerance", "message"],
            list(check.to_payload().keys()),
        )
        self.assertEqual("ERROR", check.to_payload()["severity"])
        self.assertEqual("PASS", check.to_payload()["status"])

    def test_report_payload_shape(self):
        report = RenderValidationReport(checks=(ValidationCheck(
            "duration", ValidationSeverity.ERROR, CheckStatus.PASS, 1_000, 1_000, 500
        ),), metrics={"expected_duration_ms": 1_000, "actual_duration_ms": 1_000})
        payload = report.to_payload()
        self.assertEqual({"passed", "checks", "metrics"}, set(payload.keys()))
        self.assertTrue(payload["passed"])
        self.assertEqual(1, len(payload["checks"]))

    def test_first_error_check_returns_expected(self):
        report = RenderValidationReport(checks=(
            ValidationCheck("audio_stream", ValidationSeverity.ERROR, CheckStatus.PASS),
            ValidationCheck("duration", ValidationSeverity.ERROR, CheckStatus.FAIL, 1_500, 1_000, 500),
        ))
        self.assertEqual("duration", first_error_check(report).id)


class CallbackSerializationTest(unittest.IsolatedAsyncioTestCase):
    async def test_complete_includes_validation_when_provided(self):
        with patch("app.services.callback.send_callback", new=AsyncMock(return_value=True)) as send:
            await send_complete(
                "job-1", "corr-1", "COMPLETED",
                output_ref="media/out.mp4",
                validation={"passed": True, "checks": [], "metrics": {}},
            )
        payload = send.await_args.args[1]
        self.assertEqual({"passed": True, "checks": [], "metrics": {}}, payload["validation"])

    async def test_complete_omits_validation_when_absent(self):
        with patch("app.services.callback.send_callback", new=AsyncMock(return_value=True)) as send:
            await send_complete("job-1", "corr-1", "FAILED", error={"code": "X", "message": "y"})
        payload = send.await_args.args[1]
        self.assertNotIn("validation", payload)


def render_request(**overrides) -> RenderRequest:
    values = {
        "correlation_id": "correlation-1",
        "media_job_id": "job-1",
        "source_video_ref": "media/source.mp4",
        "cut_ranges": [{"start_ms": 0, "end_ms": 1_000}],
        "audio_input_version": "1",
        "audio_source": "MIXED_AUDIO",
        "resolved_audio_ref": "media/mixed.wav",
        "subtitle_track": SubtitleTrackRequest(
            format="srt",
            content_ref="media/subtitle.srt",
            mode="SOFT_SUB",
        ),
        "callback_base_url": "http://callback.test",
    }
    values.update(overrides)
    return RenderRequest(**values)


def storage_stub() -> Mock:
    storage = Mock()
    storage.upload.side_effect = lambda _path, key: f"media/{key}"
    return storage


class RenderValidationIntegrationTest(unittest.IsolatedAsyncioTestCase):
    async def test_validation_error_fails_render_without_upload(self):
        storage = storage_stub()
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.validate_subtitle_format", return_value="srt"
        ), patch("app.api.render.shutil.copyfile"), patch("app.api.render.srt_to_vtt"), patch(
            "app.api.render.cut_and_concat_video"
        ), patch("app.api.render.replace_audio"), patch("app.api.render.mux_soft_subtitles"), patch(
            "app.services.render_validation.get_duration", return_value=10.0
        ), patch(
            "app.services.render_validation.get_stream_types",
            return_value=["video", "audio", "subtitle"],
        ):
            await process_render(render_request())

        self.assertEqual("FAILED", complete.await_args.args[2])
        self.assertEqual(
            "RENDER_VALIDATION_FAILED", complete.await_args.kwargs["error"]["code"]
        )
        self.assertFalse(complete.await_args.kwargs["error"]["retryable"])
        payload = complete.await_args.kwargs["validation"]
        self.assertFalse(payload["passed"])
        self.assertNotIn("tmp", complete.await_args.kwargs["error"]["message"])
        storage.upload.assert_not_called()

    async def test_validation_pass_completes_with_report(self):
        storage = storage_stub()
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.validate_subtitle_format", return_value="srt"
        ), patch("app.api.render.shutil.copyfile"), patch("app.api.render.srt_to_vtt"), patch(
            "app.api.render.cut_and_concat_video"
        ), patch("app.api.render.replace_audio"), patch("app.api.render.mux_soft_subtitles"), patch(
            "app.services.render_validation.get_duration", return_value=1.0
        ), patch(
            "app.services.render_validation.get_stream_types",
            return_value=["video", "audio", "subtitle"],
        ):
            await process_render(render_request())

        self.assertEqual("COMPLETED", complete.await_args.args[2])
        payload = complete.await_args.kwargs["validation"]
        self.assertTrue(payload["passed"])
        self.assertEqual(4, len(payload["checks"]))
        storage.upload.assert_called()

    async def test_soft_sub_mux_failure_fails_closed_with_subtitle_mux_failed(self):
        # Phase 0 fail-closed (docs/15 §5.5, TC-PRES-C02): a soft-sub mux failure
        # must fail the render with the retryable SUBTITLE_MUX_FAILED code —
        # never a silent fallback copy of a video without the subtitle stream.
        storage = storage_stub()
        mux_failure = FFmpegError("mux failed", "RENDER_FAILED")
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.validate_subtitle_format", return_value="srt"
        ), patch("app.api.render.shutil.copyfile") as copyfile, patch("app.api.render.srt_to_vtt"), patch(
            "app.api.render.cut_and_concat_video"
        ), patch("app.api.render.replace_audio"), patch(
            "app.api.render.mux_soft_subtitles", side_effect=mux_failure
        ), patch("app.services.render_validation.get_duration", return_value=1.0), patch(
            "app.services.render_validation.get_stream_types",
            return_value=["video", "audio"],
        ):
            await process_render(render_request())

        self.assertEqual("FAILED", complete.await_args.args[2])
        self.assertEqual(
            "SUBTITLE_MUX_FAILED", complete.await_args.kwargs["error"]["code"]
        )
        # Only the legitimate SRT input copy happens — the video fallback copy
        # (audio_replaced → final_video_path) must never occur.
        self.assertEqual(1, copyfile.call_count)
        self.assertTrue(copyfile.call_args.args[1].endswith("final.srt"))
        storage.upload.assert_not_called()
        self.assertIsNone(complete.await_args.kwargs.get("validation"))


if __name__ == "__main__":
    unittest.main()
