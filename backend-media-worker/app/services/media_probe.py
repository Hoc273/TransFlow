"""Immutable ffprobe contract for rendered media (CEP Phase C0)."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import Any, Optional, Tuple

from app.services.ffmpeg import FFmpegError


ANALYSIS_VERSION = 1


@dataclass(frozen=True)
class VideoStreamInfo:
    codec_name: str
    width_px: int
    height_px: int
    frame_rate_num: int
    frame_rate_den: int
    bitrate_bps: Optional[int]

    def to_payload(self) -> dict[str, Any]:
        return {
            "codecName": self.codec_name,
            "widthPx": self.width_px,
            "heightPx": self.height_px,
            "frameRateNum": self.frame_rate_num,
            "frameRateDen": self.frame_rate_den,
            "bitrateBps": self.bitrate_bps,
        }


@dataclass(frozen=True)
class AudioStreamInfo:
    codec_name: str
    channels: int
    sample_rate_hz: int
    bitrate_bps: Optional[int]

    def to_payload(self) -> dict[str, Any]:
        return {
            "codecName": self.codec_name,
            "channels": self.channels,
            "sampleRateHz": self.sample_rate_hz,
            "bitrateBps": self.bitrate_bps,
        }


@dataclass(frozen=True)
class SubtitleStreamInfo:
    codec_name: str
    language: Optional[str]
    index: int

    def to_payload(self) -> dict[str, Any]:
        return {
            "codecName": self.codec_name,
            "language": self.language,
            "index": self.index,
        }


@dataclass(frozen=True)
class MediaProbeResult:
    container: str
    duration_ms: int
    video: Optional[VideoStreamInfo]
    audio: Optional[AudioStreamInfo]
    subtitle_streams: Tuple[SubtitleStreamInfo, ...]
    warnings: Tuple[str, ...]
    analysis_version: int = ANALYSIS_VERSION

    def to_payload(self) -> dict[str, Any]:
        return {
            "container": self.container,
            "durationMs": self.duration_ms,
            "video": self.video.to_payload() if self.video else None,
            "audio": self.audio.to_payload() if self.audio else None,
            "subtitleStreams": [stream.to_payload() for stream in self.subtitle_streams],
            "warnings": list(self.warnings),
            "analysisVersion": self.analysis_version,
        }


def probe_video(video_path: str, timeout: int = 60) -> MediaProbeResult:
    """Run ffprobe once and return the C0 media-probe contract.

    A failed process or malformed top-level metadata is a validation failure,
    not a partial probe. Individual unusable streams are omitted with a
    warning so the validation layer can report the missing stream explicitly.
    """
    command = [
        "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", video_path,
    ]
    try:
        completed = subprocess.run(
            command, check=True, capture_output=True, text=True, timeout=timeout,
        )
        payload = json.loads(completed.stdout)
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError("ffprobe timed out", "RENDER_VALIDATION_FAILED", retryable=False) from exc
    except subprocess.CalledProcessError as exc:
        raise FFmpegError("ffprobe failed", "RENDER_VALIDATION_FAILED", retryable=False) from exc
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FFmpegError("ffprobe returned malformed metadata", "RENDER_VALIDATION_FAILED", retryable=False) from exc

    try:
        format_info = _object(payload, "format")
        container = _required_text(format_info, "format_name").split(",", 1)[0].strip()
        duration_ms = int(round(float(_required_text(format_info, "duration")) * 1000))
        if not container or duration_ms < 0:
            raise ValueError("invalid format metadata")
        streams = _streams(payload)
    except (TypeError, ValueError, OverflowError) as exc:
        raise FFmpegError("ffprobe returned malformed metadata", "RENDER_VALIDATION_FAILED", retryable=False) from exc

    warnings: list[str] = []
    video = _first_video(streams, warnings)
    audio = _first_audio(streams, warnings)
    subtitles = tuple(sorted((
        parsed for stream in streams if stream.get("codec_type") == "subtitle"
        if (parsed := _subtitle_stream(stream, warnings)) is not None
    ), key=lambda stream: stream.index))
    if video is None:
        warnings.append("video stream missing")
    if audio is None:
        warnings.append("audio stream missing")
    return MediaProbeResult(container, duration_ms, video, audio, subtitles, tuple(warnings))


def _object(payload: Any, field: str) -> dict[str, Any]:
    value = payload.get(field) if isinstance(payload, dict) else None
    if not isinstance(value, dict):
        raise ValueError(field)
    return value


def _streams(payload: Any) -> Tuple[dict[str, Any], ...]:
    value = payload.get("streams") if isinstance(payload, dict) else None
    if not isinstance(value, list) or not all(isinstance(stream, dict) for stream in value):
        raise ValueError("streams")
    return tuple(value)


def _required_text(values: dict[str, Any], field: str) -> str:
    value = values.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(field)
    return value


def _optional_non_negative_int(values: dict[str, Any], field: str, warnings: list[str]) -> Optional[int]:
    value = values.get(field)
    if value in (None, "", "N/A"):
        return None
    try:
        parsed = int(value)
        if parsed < 0:
            raise ValueError(field)
        return parsed
    except (TypeError, ValueError):
        warnings.append(f"invalid {field}")
        return None


def _positive_int(values: dict[str, Any], field: str) -> int:
    value = int(values[field])
    if value <= 0:
        raise ValueError(field)
    return value


def _frame_rate(value: Any) -> tuple[int, int]:
    numerator, denominator = str(value).split("/", 1)
    parsed = int(numerator), int(denominator)
    if parsed[0] < 0 or parsed[1] <= 0:
        raise ValueError("frame rate")
    return parsed


def _first_video(streams: Tuple[dict[str, Any], ...], warnings: list[str]) -> Optional[VideoStreamInfo]:
    for stream in streams:
        if stream.get("codec_type") != "video":
            continue
        try:
            numerator, denominator = _frame_rate(stream.get("avg_frame_rate") or stream.get("r_frame_rate"))
            return VideoStreamInfo(
                _required_text(stream, "codec_name"), _positive_int(stream, "width"),
                _positive_int(stream, "height"), numerator, denominator,
                _optional_non_negative_int(stream, "bit_rate", warnings),
            )
        except (KeyError, TypeError, ValueError):
            warnings.append("video stream metadata malformed")
            return None
    return None


def _first_audio(streams: Tuple[dict[str, Any], ...], warnings: list[str]) -> Optional[AudioStreamInfo]:
    for stream in streams:
        if stream.get("codec_type") != "audio":
            continue
        try:
            return AudioStreamInfo(
                _required_text(stream, "codec_name"), _positive_int(stream, "channels"),
                _positive_int(stream, "sample_rate"), _optional_non_negative_int(stream, "bit_rate", warnings),
            )
        except (KeyError, TypeError, ValueError):
            warnings.append("audio stream metadata malformed")
            return None
    return None


def _subtitle_stream(stream: dict[str, Any], warnings: list[str]) -> Optional[SubtitleStreamInfo]:
    try:
        codec_name = _required_text(stream, "codec_name")
        index = int(stream["index"])
        if index < 0:
            raise ValueError("index")
    except (KeyError, TypeError, ValueError):
        warnings.append("subtitle stream metadata malformed")
        return None
    tags = stream.get("tags")
    language = tags.get("language") if isinstance(tags, dict) and isinstance(tags.get("language"), str) else None
    return SubtitleStreamInfo(codec_name, language, index)
