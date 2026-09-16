import json
import subprocess
import unittest
from unittest.mock import patch

from app.services.ffmpeg import FFmpegError
from app.services.media_probe import MediaProbeResult, probe_video
from app.services.render_validation import DurationValidator, ValidationContext


def ffprobe_payload(streams):
    return {
        "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "1.234"},
        "streams": streams,
    }


VIDEO = {
    "index": 0, "codec_type": "video", "codec_name": "h264", "width": 1920,
    "height": 1080, "avg_frame_rate": "30000/1001", "bit_rate": "4200000",
}
AUDIO = {
    "index": 1, "codec_type": "audio", "codec_name": "aac", "channels": 2,
    "sample_rate": "44100", "bit_rate": "128000",
}


class MediaProbeTest(unittest.TestCase):
    def probe(self, payload):
        completed = subprocess.CompletedProcess(["ffprobe"], 0, json.dumps(payload), "")
        with patch("app.services.media_probe.subprocess.run", return_value=completed):
            return probe_video("/tmp/final.mp4")

    def test_parses_all_contract_fields(self):
        result = self.probe(ffprobe_payload([VIDEO, AUDIO]))

        self.assertEqual("mov", result.container)
        self.assertEqual(1_234, result.duration_ms)
        self.assertEqual("h264", result.video.codec_name)
        self.assertEqual((30_000, 1_001), (result.video.frame_rate_num, result.video.frame_rate_den))
        self.assertEqual("aac", result.audio.codec_name)
        self.assertEqual(1, result.analysis_version)

    def test_missing_streams_are_reported_without_partial_stream_objects(self):
        result = self.probe(ffprobe_payload([]))

        self.assertIsNone(result.video)
        self.assertIsNone(result.audio)
        self.assertIn("video stream missing", result.warnings)
        self.assertIn("audio stream missing", result.warnings)

    def test_malformed_json_is_validation_failure(self):
        completed = subprocess.CompletedProcess(["ffprobe"], 0, "not-json", "")
        with patch("app.services.media_probe.subprocess.run", return_value=completed):
            with self.assertRaises(FFmpegError) as raised:
                probe_video("/tmp/final.mp4")

        self.assertEqual("RENDER_VALIDATION_FAILED", raised.exception.code)
        self.assertFalse(raised.exception.retryable)

    def test_preserves_multiple_subtitle_streams_in_ffprobe_index_order(self):
        first = {"index": 2, "codec_type": "subtitle", "codec_name": "subrip", "tags": {"language": "en"}}
        second = {"index": 3, "codec_type": "subtitle", "codec_name": "ass", "tags": {"language": "vi"}}
        result = self.probe(ffprobe_payload([VIDEO, AUDIO, second, first]))

        self.assertEqual([2, 3], [stream.index for stream in result.subtitle_streams])
        self.assertEqual(["en", "vi"], [stream.language for stream in result.subtitle_streams])

    def test_payload_uses_camel_case_and_analysis_version(self):
        result = self.probe(ffprobe_payload([VIDEO, AUDIO]))
        payload = result.to_payload()

        self.assertEqual(1, payload["analysisVersion"])
        self.assertIn("durationMs", payload)
        self.assertIn("frameRateNum", payload["video"])
        self.assertNotIn("subtitle_streams", payload)

    def test_duration_validator_uses_probe_without_second_ffprobe(self):
        probe = self.probe(ffprobe_payload([VIDEO, AUDIO]))
        context = ValidationContext(
            video_path="/tmp/final.mp4", subtitle_path=None, subtitle_format="srt",
            subtitle_mode="SOFT_SUB", expected_duration_ms=1_234,
            tolerance_ms=0, tolerance_pct=0, media_probe=probe,
        )
        with patch("app.services.render_validation.get_duration") as get_duration:
            check = DurationValidator().validate(context)

        get_duration.assert_not_called()
        self.assertEqual("PASS", check.status.value)
