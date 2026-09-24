import json
import logging
import math
import os
import re
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from typing import List, Optional, Tuple

from pydub import AudioSegment

from app.core.config import settings

logger = logging.getLogger(__name__)

# Default subprocess timeout (seconds). Overridable per-call.
_DEFAULT_TIMEOUT = 600
_ALLOWED_SUBTITLE_FORMATS = {"srt", "vtt", "ass"}


class FFmpegError(Exception):
    """Raised when ffmpeg/ffprobe fails; carries a stable error code for Spring Boot."""

    def __init__(
        self,
        message: str,
        code: str = "FFMPEG_FAILED",
        *,
        retryable: bool = True,
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.details = details


_TTS_EXTS = frozenset({"mp3", "wav", "ogg", "m4a", "flac", "webm", "aac"})


def _local_tts_path(temp_dir: str, segment_id: str, audio_ref: str | None) -> str:
    """Preserve container extension from object key so pydub/ffmpeg sniff correctly.

    Historical keys end in ``.mp3``; DashScope Omni TTS is stored as ``.wav``.
    Hardcoding ``.mp3`` caused ``Header missing`` / decode-error-rate failures.
    """
    ext = "mp3"
    if audio_ref:
        name = audio_ref.rsplit("/", 1)[-1]
        if "." in name:
            cand = name.rsplit(".", 1)[-1].lower()
            if cand in _TTS_EXTS:
                ext = cand
    return os.path.join(temp_dir, f"tts_{segment_id}.{ext}")


@dataclass
class CutRange:
    start_ms: int
    end_ms: int


@dataclass
class SegmentAudio:
    segment_id: str
    audio_ref: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class VideoDurationProbe:
    """Physical duration evidence for the first video stream."""

    container_duration_ms: int | None
    video_stream_start_ms: int
    video_stream_duration_ms: int
    video_stream_end_ms: int
    duration_source: str
    fallback_diagnostic: str | None = None

    def to_diagnostics(self) -> dict:
        return {
            "durationAuthority": "VIDEO_STREAM",
            "durationSource": self.duration_source,
            "containerDurationMs": self.container_duration_ms,
            "videoStreamStartMs": self.video_stream_start_ms,
            "videoStreamDurationMs": self.video_stream_duration_ms,
            "videoStreamEndMs": self.video_stream_end_ms,
            "fallbackDiagnostic": self.fallback_diagnostic,
        }


def _strip_ffmpeg_banner(stderr: str) -> str:
    lines = (stderr or "").splitlines()
    body_lines = [
        line for line in lines
        if not (line.strip().startswith("configuration:")
                or line.strip().startswith("libav")
                or line.strip().startswith("libsw")
                or line.strip().startswith("libpostproc")
                or line.strip().startswith("built with")
                or line.strip().startswith("ffmpeg version"))
    ]
    return "\n".join(body_lines)


def _classify_ffmpeg_error(stderr: str) -> tuple[str, bool]:
    stripped = _strip_ffmpeg_banner(stderr)
    text = stripped.lower()
    non_retryable_patterns = (
        ("unknown decoder", "CODEC_UNSUPPORTED"),
        ("unknown encoder", "CODEC_UNSUPPORTED"),
        ("unsupported codec", "CODEC_UNSUPPORTED"),
        ("codec not supported", "CODEC_UNSUPPORTED"),
        ("codec is not supported", "CODEC_UNSUPPORTED"),
        ("could not find codec", "CODEC_UNSUPPORTED"),
        ("codec not found", "CODEC_UNSUPPORTED"),
        ("codec", "CODEC_UNSUPPORTED"),
        ("unsupported", "CODEC_UNSUPPORTED"),
        ("invalid data", "INVALID_INPUT"),
        ("does not contain any stream", "INVALID_INPUT"),
        ("no such file", "INVALID_INPUT"),
        ("unknown format", "UNSUPPORTED_FORMAT"),
        ("invalid argument", "INVALID_INPUT"),
    )
    for keyword, code in non_retryable_patterns:
        if keyword in text:
            return code, False
    if "timed out" in text or "timeout" in text:
        return "RENDER_TIMEOUT", False
    return "RENDER_FAILED", True


def _sanitize_ffmpeg_log(text: str) -> str:
    if not text:
        return ""
    return re.sub(r'([a-zA-Z]:[\\/][^\s"\'<>]+|/(?:[^\s"\'<>]+/)+[^\s"\'<>]*)', '<path>', text)


# Final deliverables only: move the MP4 index (moov) to the front so browsers
# can start playback from a presigned URL without fetching the file tail.
_FASTSTART = ["-movflags", "+faststart"]


def _run(cmd: List[str], timeout: int = _DEFAULT_TIMEOUT, **kwargs) -> None:
    logger.info("Running ffmpeg operation=%s", cmd[0])
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout, **kwargs)
    except subprocess.TimeoutExpired as exc:
        logger.error("ffmpeg timed out after %ss", timeout)
        raise FFmpegError(f"ffmpeg timed out after {timeout}s", "RENDER_TIMEOUT", retryable=False) from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr or ""
        code, retryable = _classify_ffmpeg_error(stderr)
        logger.error("ffmpeg failed code=%s retryable=%s: %s", code, retryable, _sanitize_ffmpeg_log(stderr.strip()))
        raise FFmpegError("ffmpeg command failed", code, retryable=retryable) from exc


def get_duration(path: str, timeout: int = 60) -> float:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError("ffprobe timed out", "RENDER_TIMEOUT", retryable=False) from exc
    except subprocess.CalledProcessError as exc:
        code, retryable = _classify_ffmpeg_error(exc.stderr or "")
        raise FFmpegError(exc.stderr or str(exc), code, retryable=retryable) from exc
    return float(result.stdout.strip())


def _finite_seconds(value: object) -> float | None:
    if value in (None, "", "N/A", "NB"):
        return None
    if not isinstance(value, (int, float, str)) or isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _duration_ms(value: object) -> int | None:
    seconds = _finite_seconds(value)
    if seconds is None or seconds < 0:
        return None
    return int(round(seconds * 1000))


def _frame_rate_seconds(value: object) -> float | None:
    if not isinstance(value, str) or "/" not in value:
        return None
    numerator, denominator = value.split("/", 1)
    try:
        numerator_f = float(numerator)
        denominator_f = float(denominator)
    except ValueError:
        return None
    if numerator_f <= 0 or denominator_f <= 0:
        return None
    return denominator_f / numerator_f


def _run_ffprobe_json(command: list[str], path: str, timeout: int) -> dict:
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=timeout)
        payload = json.loads(result.stdout)
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError("ffprobe timed out", "RENDER_TIMEOUT", retryable=False) from exc
    except subprocess.CalledProcessError as exc:
        code, retryable = _classify_ffmpeg_error(exc.stderr or "")
        raise FFmpegError(exc.stderr or str(exc), code, retryable=retryable) from exc
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError) as exc:
        raise FFmpegError(
            f"ffprobe returned malformed duration metadata for {path}",
            "GENERATIVE_SOURCE_DURATION_UNAVAILABLE",
            retryable=False,
        ) from exc
    if not isinstance(payload, dict):
        raise FFmpegError(
            f"ffprobe returned malformed duration metadata for {path}",
            "GENERATIVE_SOURCE_DURATION_UNAVAILABLE",
            retryable=False,
        )
    return payload


def _probe_video_frame_end(path: str, timeout: int, frame_interval_s: float | None) -> float | None:
    """Derive v:0 EOF from decoded frame timestamps when stream.duration is N/A."""
    command = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "frame=best_effort_timestamp_time,pkt_duration_time",
        "-of", "csv=p=0",
        path,
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, OSError) as exc:
        logger.warning("video stream timestamp fallback failed path=%s error=%s", path, exc)
        return None

    last_end_s: float | None = None
    for line in result.stdout.splitlines():
        fields = [field.strip() for field in line.split(",")]
        timestamp_s = _finite_seconds(fields[0] if fields else None)
        if timestamp_s is None:
            continue
        packet_duration_s = _finite_seconds(fields[1] if len(fields) > 1 else None)
        duration_s = packet_duration_s if packet_duration_s and packet_duration_s > 0 else frame_interval_s
        candidate_end_s = timestamp_s + duration_s if duration_s else timestamp_s
        last_end_s = candidate_end_s if last_end_s is None else max(last_end_s, candidate_end_s)
    return last_end_s


def probe_video_stream_duration(path: str, timeout: int = 60) -> VideoDurationProbe:
    """Probe physical EOF from v:0, never from container duration.

    The container duration is returned only as comparison evidence. If the
    stream duration is unavailable, a frame-timestamp fallback is attempted and
    labeled in the result; container duration is never used as video authority.
    """
    command = [
        "ffprobe",
        "-v", "error",
        "-show_format",
        "-show_streams",
        "-of", "json",
        path,
    ]
    payload = _run_ffprobe_json(command, path, timeout)
    format_value = payload.get("format")
    format_info = format_value if isinstance(format_value, dict) else {}
    container_duration_ms = _duration_ms(format_info.get("duration"))
    streams_value = payload.get("streams")
    streams = streams_value if isinstance(streams_value, list) else []
    video_stream = next(
        (stream for stream in streams or []
         if isinstance(stream, dict) and stream.get("codec_type") == "video"),
        None,
    )
    if video_stream is None:
        raise FFmpegError(
            f"video stream v:0 is unavailable for {path}",
            "GENERATIVE_SOURCE_DURATION_UNAVAILABLE",
            retryable=False,
            details={
                "durationAuthority": "VIDEO_STREAM",
                "containerDurationMs": container_duration_ms,
                "videoStreamDurationMs": None,
            },
        )

    stream_start_s = _finite_seconds(video_stream.get("start_time")) or 0.0
    stream_duration_s = _finite_seconds(video_stream.get("duration"))
    duration_source = "video_stream.duration"
    fallback_diagnostic = None
    if stream_duration_s is None or stream_duration_s <= 0:
        frame_interval_s = _frame_rate_seconds(
            video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate")
        )
        frame_end_s = _probe_video_frame_end(path, timeout, frame_interval_s)
        if frame_end_s is None or frame_end_s <= stream_start_s:
            raise FFmpegError(
                f"video stream duration metadata unavailable for {path}; "
                "container duration is not a valid video fallback",
                "GENERATIVE_SOURCE_DURATION_UNAVAILABLE",
                retryable=False,
                details={
                    "durationAuthority": "VIDEO_STREAM",
                    "durationSource": "video_stream.frame_timestamps",
                    "containerDurationMs": container_duration_ms,
                    "videoStreamStartMs": int(round(stream_start_s * 1000)),
                    "videoStreamDurationMs": None,
                    "videoStreamEndMs": None,
                },
            )
        stream_end_s = frame_end_s
        stream_duration_s = stream_end_s - stream_start_s
        duration_source = "video_stream.frame_timestamps"
        fallback_diagnostic = "stream.duration unavailable; derived from v:0 frame timestamps"
    else:
        stream_end_s = stream_start_s + stream_duration_s

    video_stream_start_ms = int(round(stream_start_s * 1000))
    video_stream_end_ms = int(round(stream_end_s * 1000))
    video_stream_duration_ms = max(1, video_stream_end_ms - video_stream_start_ms)
    return VideoDurationProbe(
        container_duration_ms=container_duration_ms,
        video_stream_start_ms=video_stream_start_ms,
        video_stream_duration_ms=video_stream_duration_ms,
        video_stream_end_ms=video_stream_end_ms,
        duration_source=duration_source,
        fallback_diagnostic=fallback_diagnostic,
    )


def get_stream_types(path: str, timeout: int = 60) -> list[str]:
    """Return the ordered list of stream codec types (e.g. ['video', 'audio', 'subtitle']).

    Phase D P0 fix: ffprobe 7.x with ``-of default=nw=1`` prints keyed lines
    (``codec_type=audio``), so callers using ``"audio" in get_stream_types(...)``
    matched nothing and every EXTRACT_AUDIO failed with NO_AUDIO_STREAM. Request
    bare values (``nokey=1``) exactly like the other probes in this file.
    """
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "stream=codec_type",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError("ffprobe timed out", "RENDER_TIMEOUT", retryable=False) from exc
    except subprocess.CalledProcessError as exc:
        code, retryable = _classify_ffmpeg_error(exc.stderr or "")
        raise FFmpegError(exc.stderr or str(exc), code, retryable=retryable) from exc
    return [line.strip().lower() for line in result.stdout.splitlines() if line.strip()]


def has_audio_stream(path: str, timeout: int = 60) -> bool:
    """Return True if the file contains at least one audio stream."""
    return "audio" in get_stream_types(path, timeout)


def get_video_height(path: str, timeout: int = 60) -> int:
    """Return the first video stream height for percentage-based subtitle placement."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=height",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)
        return max(1, int(result.stdout.strip()))
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError("ffprobe timed out", "RENDER_TIMEOUT", retryable=False) from exc
    except (subprocess.CalledProcessError, ValueError) as exc:
        stderr = exc.stderr if isinstance(exc, subprocess.CalledProcessError) else str(exc)
        code, retryable = _classify_ffmpeg_error(stderr or "")
        raise FFmpegError(stderr or str(exc), code, retryable=retryable) from exc


def get_video_width(path: str, timeout: int = 60) -> int:
    """Return the first video stream width (Phase 4 mask geometry)."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)
        return max(1, int(result.stdout.strip()))
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError("ffprobe timed out", "RENDER_TIMEOUT", retryable=False) from exc
    except (subprocess.CalledProcessError, ValueError) as exc:
        stderr = exc.stderr if isinstance(exc, subprocess.CalledProcessError) else str(exc)
        code, retryable = _classify_ffmpeg_error(stderr or "")
        raise FFmpegError(stderr or str(exc), code, retryable=retryable) from exc


def extract_audio(source_path: str, output_path: str) -> None:
    if not has_audio_stream(source_path):
        raise FFmpegError(
            "Video does not contain an audio track",
            "NO_AUDIO_STREAM",
            retryable=False,
        )
    cmd = [
        "ffmpeg",
        "-y",
        "-i", source_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        output_path,
    ]
    _run(cmd)


def fit_dub_audio(
    segment_path: str,
    target_ms: int,
    temp_dir: str,
    *,
    segment_id: str = "",
) -> Tuple[str, Optional[dict]]:
    """Fit TTS into a slot and report any required truncation as a warning."""
    audio = AudioSegment.from_file(segment_path)
    target = max(target_ms, 1)
    original_ms = len(audio)
    output_path = os.path.join(temp_dir, f"fitted_{uuid.uuid4()}.wav")

    if original_ms <= target:
        padded = audio + AudioSegment.silent(duration=target - original_ms)
        padded.export(output_path, format="wav")
        return output_path, None

    over_by = (original_ms / target) - 1.0

    # ffmpeg's atempo filter preserves pitch. Cap stretching
    # at 20% and truncate any remaining tail to the exact segment duration.
    speed = min(original_ms / target, 1.20)
    cmd = [
        "ffmpeg",
        "-y",
        "-i", segment_path,
        "-filter:a", f"atempo={speed:.6f}",
        "-t", str(target / 1000.0),
        output_path,
    ]
    _run(cmd)

    warning = None
    if over_by > 0.20:
        warning = {
            "code": "AUDIO_TRUNCATED",
            "exceeded_ms": int(original_ms - target),
            "segment_id": segment_id,
        }
    return output_path, warning


def _extract_video_segment(source_path: str, start_ms: int, end_ms: int, output_path: str) -> None:
    duration_ms = end_ms - start_ms
    cmd = [
        "ffmpeg",
        "-y",
        "-i", source_path,
        # Accurate seek must happen after input decoding. Stream-copy seeks to the
        # previous keyframe and was visibly including the wrong source scene.
        "-ss", str(start_ms / 1000.0),
        "-t", str(duration_ms / 1000.0),
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-reset_timestamps", "1",
        output_path,
    ]
    _run(cmd)


def cut_and_concat_video(source_path: str, cut_ranges: List[CutRange], output_path: str, temp_dir: str) -> None:
    segment_files: List[str] = []
    for i, r in enumerate(cut_ranges):
        segment_path = os.path.join(temp_dir, f"segment_{i}.mp4")
        _extract_video_segment(source_path, r.start_ms, r.end_ms, segment_path)
        segment_files.append(segment_path)

    list_path = os.path.join(temp_dir, "concat_list.txt")
    with open(list_path, "w", encoding="utf-8") as f:
        for segment in segment_files:
            # Escape single quotes for ffmpeg concat demuxer
            escaped = segment.replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")

    cmd = [
        "ffmpeg",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", list_path,
        "-c", "copy",
        output_path,
    ]
    _run(cmd)


def extract_audio_segment(source_path: str, start_ms: int, end_ms: int, output_path: str) -> None:
    duration_ms = end_ms - start_ms
    cmd = [
        "ffmpeg",
        "-y",
        "-ss", str(start_ms / 1000.0),
        "-t", str(duration_ms / 1000.0),
        "-i", source_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        output_path,
    ]
    _run(cmd)


def build_dubbed_audio(
    source_path: str,
    cut_ranges: List[CutRange],
    segment_audios: List[SegmentAudio],
    temp_dir: str,
) -> Tuple[str, List[dict]]:
    """Build a full DUB_REPLACE audio track for the final video.

    audio_mode=DUBBED means replace source speech with TTS (docs/16, StrategyKey
    DUB_REPLACE). The base must be silence — never the original track — otherwise
    source language and dubbed audio play on top of each other.
    ``source_path`` is kept for call-site compatibility / future bed-duck work.
    """
    _ = source_path  # DUB_REPLACE does not mix original speech.
    warnings: List[dict] = []

    cut_audios: List[AudioSegment] = []
    for r in cut_ranges:
        target_len = max(0, r.end_ms - r.start_ms)
        # DUB_REPLACE: silent bed, place fitted TTS into each segment slot.
        cut_audio = AudioSegment.silent(duration=target_len)

        for sa in segment_audios:
            if sa.start_ms >= r.end_ms or sa.end_ms <= r.start_ms:
                continue
            # Segment straddling two cut ranges — skip with warning (M8)
            if sa.start_ms < r.start_ms or sa.end_ms > r.end_ms:
                warnings.append({
                    "segment_id": sa.segment_id,
                    "code": "SEGMENT_CROSS_RANGE",
                    "message": "Segment straddles cut ranges; slot left silent",
                })
                continue
            from app.services.storage import get_storage
            storage = get_storage()
            tts_local = _local_tts_path(temp_dir, sa.segment_id, sa.audio_ref)
            storage.download(sa.audio_ref, tts_local)
            target_ms = sa.end_ms - sa.start_ms
            fitted_path, warning = fit_dub_audio(
                tts_local,
                target_ms,
                temp_dir,
                segment_id=sa.segment_id,
            )
            if warning:
                warnings.append(warning)
            fitted_audio = AudioSegment.from_file(fitted_path)
            position = sa.start_ms - r.start_ms
            cut_audio = cut_audio.overlay(fitted_audio, position=position)

        cut_audios.append(cut_audio)

    if not cut_audios:
        final_audio = AudioSegment.silent(duration=0)
    else:
        final_audio = cut_audios[0]
        for audio in cut_audios[1:]:
            final_audio += audio

    output_path = os.path.join(temp_dir, "final_audio.wav")
    final_audio.export(output_path, format="wav")
    return output_path, warnings


def build_original_audio(source_path: str, cut_ranges: List[CutRange], temp_dir: str) -> str:
    audios: List[AudioSegment] = []
    for r in cut_ranges:
        path = os.path.join(temp_dir, f"orig_{r.start_ms}_{r.end_ms}.wav")
        extract_audio_segment(source_path, r.start_ms, r.end_ms, path)
        audio = AudioSegment.from_file(path)
        target = r.end_ms - r.start_ms
        if len(audio) > target:
            audio = audio[:target]
        elif len(audio) < target:
            audio = audio + AudioSegment.silent(duration=target - len(audio))
        audios.append(audio)

    if not audios:
        final = AudioSegment.silent(duration=0)
    else:
        final = audios[0]
        for a in audios[1:]:
            final += a
    output_path = os.path.join(temp_dir, "final_audio.wav")
    final.export(output_path, format="wav")
    return output_path


def _escape_subtitles_path(path: str) -> str:
    """Escape path for ffmpeg subtitles filter (Windows-safe)."""
    escaped = path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    return escaped


def validate_subtitle_format(fmt: str) -> str:
    normalized = (fmt or "srt").lower().strip()
    if normalized not in _ALLOWED_SUBTITLE_FORMATS:
        raise FFmpegError(
            f"Unsupported subtitle format: {fmt}",
            "UNSUPPORTED_FORMAT",
            retryable=False,
        )
    return normalized


def srt_to_vtt(srt_path: str, vtt_path: str) -> None:
    """Convert SRT to WebVTT (minimal, timestamp comma→dot)."""
    with open(srt_path, "r", encoding="utf-8") as src:
        content = src.read()
    # Replace SRT timestamp commas with VTT dots
    converted = re.sub(
        r"(\d{2}:\d{2}:\d{2}),(\d{3})",
        r"\1.\2",
        content,
    )
    with open(vtt_path, "w", encoding="utf-8") as dst:
        if not converted.lstrip().startswith("WEBVTT"):
            dst.write("WEBVTT\n\n")
        dst.write(converted)


def vtt_to_srt(vtt_path: str, srt_path: str) -> None:
    """Convert WebVTT to SRT (minimal)."""
    with open(vtt_path, "r", encoding="utf-8") as src:
        lines = src.readlines()
    out: list[str] = []
    index = 1
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line or line.startswith("WEBVTT") or line.startswith("NOTE") or line.startswith("STYLE"):
            i += 1
            continue
        # cue identifier or timing line
        if "-->" not in line:
            i += 1
            if i < len(lines) and "-->" in lines[i]:
                timing = lines[i].strip()
                i += 1
            else:
                continue
        else:
            timing = line
            i += 1
        timing = timing.replace(".", ",")
        # strip optional cue settings after end timestamp
        if "-->" in timing:
            parts = timing.split("-->")
            start = parts[0].strip()
            end = parts[1].strip().split()[0] if parts[1].strip() else parts[1].strip()
            timing = f"{start} --> {end}"
        text_lines: list[str] = []
        while i < len(lines) and lines[i].strip():
            text_lines.append(lines[i].rstrip("\n"))
            i += 1
        if text_lines:
            out.append(str(index))
            out.append(timing)
            out.extend(text_lines)
            out.append("")
            index += 1
        i += 1
    with open(srt_path, "w", encoding="utf-8") as dst:
        dst.write("\n".join(out))
        if out and out[-1] != "":
            dst.write("\n")


def _srt_vtt_to_ass(
    subtitle_path: str,
    fmt: str,
    width: int,
    height: int,
    *,
    alignment: int = 2,
    margin_v: int = 0,
    background_box: bool = True,
    background_color: str | None = None,
    text_color: str | None = None,
    outline_width: int | None = None,
    outline_color: str | None = None,
) -> str:
    """Convert an SRT/VTT subtitle to a temp ASS file whose ``PlayResX``/``PlayResY``
    match the video frame.

    Root cause (PRESET-VIZ, docs/97 §19.16): libass reads SRT/VTT with a *fixed*
    ``PlayResY`` of 288 (the classic 4:3 288p default), so a pixel-valued
    ``force_style`` ``MarginV`` is massively mis-scaled — the subtitle lands in
    the wrong vertical region (e.g. a BOTTOM anchor at 12% from the bottom
    renders mid-frame). Pinning ``PlayResX``/``PlayResY`` to the video frame makes
    ``MarginV`` map 1:1 to video pixels, restoring correct positioning for the
    legacy SRT/VTT burn path (the ASS/styled path already carries its own
    PlayRes from Spring's ``AssGenerator``).

    2026-09 dual-event: when ``background_box`` carries an explicit outline
    override, a single ``BorderStyle=3`` style cannot express the white glyph
    border (the box owns ``OutlineColour``). Emit two styles — ``Box`` (Layer
    0, yellow opaque box, transparent glyphs) UNDER ``Default`` (Layer 1,
    ring text with the authored outline) — with identical ``\\pos``/
    alignment/``MarginV`` so positioning is byte-identical to the single
    path. Without the combination the historical single style is emitted
    byte-identical.
    """
    normalized = (fmt or "srt").lower().strip()
    if normalized == "vtt":
        srt_tmp = subtitle_path + ".srt"
        vtt_to_srt(subtitle_path, srt_tmp)
        source = srt_tmp
    else:
        source = subtitle_path
    with open(source, "r", encoding="utf-8", errors="ignore") as fh:
        raw = fh.read()

    def to_ass_ts(ts: str) -> str:
        ts = ts.strip().replace(",", ".")
        hh, mm, rest = ts.split(":")
        if "." in rest:
            ss, frac = rest.split(".")
        else:
            ss, frac = rest, "0"
        cs = int(frac.ljust(2, "0")[:2])
        return f"{int(hh)}:{mm}:{ss}.{cs:02d}"

    events: list[str] = []
    for block in re.split(r"\n\s*\n", raw.strip()):
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        idx = 0
        if "-->" not in lines[0]:
            idx = 1
        if idx >= len(lines) or "-->" not in lines[idx]:
            continue
        parts = lines[idx].split("-->")
        start = parts[0].strip()
        end = parts[1].strip().split()[0] if parts[1].strip() else parts[1].strip()
        text_lines = lines[idx + 1:]
        if not text_lines:
            continue
        escaped = [tl.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
                   for tl in text_lines]
        # Explicit ASS positioning is deterministic across libass versions.
        # MarginV on a converted SRT style/event is otherwise ignored during
        # layout, which leaves CENTER cues at the frame midpoint instead of the
        # requested offset scanline.
        anchor_y = height - margin_v if alignment == 2 else margin_v
        position_tag = f"{{\\an{alignment}\\pos({round(width / 2)},{anchor_y})}}"
        text = position_tag + "\\N".join(escaped)
        events.append((to_ass_ts(start), to_ass_ts(end), text))

    dual = bool(background_box) and (outline_width is not None or outline_color is not None)
    if not dual:
        event_lines = [
            f"Dialogue: 0,{s},{e},Default,,0,0,{margin_v},,{t}"
            for s, e, t in events
        ]
        styles = (
            f"Style: Default,Arial,44,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,0,0,{alignment},10,10,{margin_v},1\n"
        )
    else:
        if background_color is not None:
            ass_bg = _hex8_to_ass_backcolour(_normalize_background_color(background_color))
        else:
            ass_bg = "&H80000000"
        if text_color is not None:
            ass_text = _hex_to_ass_primarycolour(_normalize_text_color(text_color))
        else:
            ass_text = "&H00FFFFFF"
        ring_width = _validate_ring_outline_width(outline_width)
        if outline_color is not None:
            ring_colour = _hex_to_ass_primarycolour(_normalize_outline_color(outline_color))
        else:
            ring_colour = "&H00000000"
        styles = (
            f"Style: Box,Arial,44,&HFF000000,&H000000FF,{ass_bg},{ass_bg},0,0,0,0,100,100,0,0,3,{_BOX_OUTLINE_EXTENT},0,{alignment},10,10,{margin_v},1\n"
            f"Style: Default,Arial,44,{ass_text},&H000000FF,{ring_colour},&H80000000,0,0,0,0,100,100,0,0,1,{ring_width},0,{alignment},10,10,{margin_v},1\n"
        )
        event_lines = []
        for s, e, t in events:
            event_lines.append(f"Dialogue: 0,{s},{e},Box,,0,0,{margin_v},,{t}")
            event_lines.append(f"Dialogue: 1,{s},{e},Default,,0,0,{margin_v},,{t}")

    ass = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n"
        "ScaledBorderAndShadow: yes\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        + styles +
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        + "\n".join(event_lines)
        + "\n"
    )
    fd, ass_path = tempfile.mkstemp(suffix=".ass", dir=os.path.dirname(subtitle_path) or None)
    os.close(fd)
    with open(ass_path, "w", encoding="utf-8") as out:
        out.write(ass)
    return ass_path


def burn_subtitles(
    video_path: str,
    subtitle_path: str,
    output_path: str,
    *,
    position: str = "BOTTOM",
    vertical_offset_percent: int = 0,
    background_box: bool = True,
    background_color: str | None = None,
    text_color: str | None = None,
    subtitle_format: str = "srt",
    font_size: int | None = None,
    bold: bool | None = None,
    mask: dict | None = None,
    outline_width: int | None = None,
    outline_color: str | None = None,
    layers: list[dict] | None = None,
    output_aspect_ratio: str | None = None,
) -> None:
    escaped = _escape_subtitles_path(subtitle_path)
    normalized_format = (subtitle_format or "srt").lower().strip()
    # OUTPUT-ASPECT (docs/97 §19.19): resolve the target frame ONCE — the
    # reframe (blur-pad) runs FIRST in the filtergraph, so every downstream
    # percent geometry (mask/layers/scanline/PlayRes) uses the TARGET dims,
    # never the source probe. Identity (no aspect requested) skips the probe
    # entirely — the historical paths stay byte-identical.
    aspect = _validate_output_aspect_ratio(output_aspect_ratio)
    target: tuple[int, int] | None = None
    reframe_graph: str | None = None
    if aspect:
        src_width = get_video_width(video_path)
        src_height = get_video_height(video_path)
        target = _reframe_target_dims(src_width, src_height, aspect)
        reframe_graph = _build_reframe_filter(src_width, src_height, aspect)
    out_width, out_height = target if target else (None, None)
    # Phase 4 (docs/16 §7.1) + PRESET-VIZ (docs/97 §19.16) + V2 layers
    # (docs/97 §19.17 §E): cover overlays chain with the subtitles filter in
    # ONE filtergraph — one encode pass, never two. Precedence (wire contract):
    # non-empty v2 layers are authoritative and the v1 mask field is ignored
    # (no double-burn); with layers absent/empty a present mask runs the v1
    # path unchanged.
    if layers:
        cover = _build_layer_filters(layers, video_path, position, vertical_offset_percent,
                                     frame_size=(out_width, out_height) if target else None)
    elif mask is not None:
        cover = _build_mask_filter(mask, video_path, position, vertical_offset_percent,
                                   frame_size=(out_width, out_height) if target else None)
    else:
        cover = None
    if normalized_format == "ass":
        # B1.0 (docs/93 §4.6.6): ASS carries the Spring-owned style — never apply
        # force_style (it would override the embedded style). Pin fontsdir to the
        # only bundled family (fonts-dejavu-core) so libass fontconfig resolution
        # is deterministic instead of guessing. Typography overrides are folded
        # into the ASS by Spring; font_size/bold must never reach the ASS path.
        fonts_dir = _escape_subtitles_path(settings.subtitle_fonts_dir)
        subtitle_filter = f"subtitles={escaped}:fontsdir={fonts_dir}"
        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,
            "-vf", _compose_vf(reframe_graph, _chain_mask(subtitle_filter, cover)),
            "-c:a", "copy",
            "-c:v", "libx264",
            "-preset", "fast",
            *_FASTSTART,
            output_path,
        ]
        _run(cmd, timeout=max(_DEFAULT_TIMEOUT, 1800))
        return
    normalized_position = (position or "BOTTOM").upper()
    if normalized_position not in {"TOP", "CENTER", "BOTTOM"}:
        raise FFmpegError(
            f"Unsupported subtitle position: {position}",
            "INVALID_INPUT",
            retryable=False,
        )
    offset = max(-30, min(30, int(vertical_offset_percent)))
    base_percent = {"TOP": 8, "CENTER": 50, "BOTTOM": 88}[normalized_position]
    desired_percent = max(3, min(95, base_percent + offset))
    if target:
        height, width = out_height, out_width
    else:
        height = get_video_height(video_path)
        width = get_video_width(video_path)
    if normalized_position == "BOTTOM":
        alignment = 2
        margin_v = round(height * (100 - desired_percent) / 100)
    else:
        # Alignment 8 anchors at the requested top/center scanline; this makes
        # percentage offsets deterministic across landscape and portrait video.
        alignment = 8
        margin_v = round(height * desired_percent / 100)
    # font_size / outline_width are authored against a 1080-line frame (the
    # Render Studio preview's PLAY_RES_Y). PlayRes is pinned to the real output
    # frame, so scale them to its height — otherwise a 720p source reframed to
    # 9:16 (404x720) burns text 1.5x larger than the preview on a narrow frame.
    if font_size is not None and not 16 <= font_size <= 120:
        raise FFmpegError(
            f"Invalid font_size: {font_size}",
            "INVALID_INPUT",
            retryable=False,
        )
    if outline_width is not None:
        _validate_ring_outline_width(outline_width)
    font_px = _scale_to_frame(font_size, height, minimum=8)
    outline_px = _scale_to_frame(outline_width, height, minimum=1 if outline_width else 0)
    if outline_px is not None:
        outline_px = min(outline_px, _RING_OUTLINE_WIDTH_MAX)
    # PRESET-VIZ (docs/97 §19.16): background_color (#RRGGBBAA) overrides the
    # historical fixed &H80000000 for the legacy force_style path. Absent →
    # byte-identical historical behavior. ASS/styled path is unaffected (the
    # assigned SubtitleStyleSnapshot owns the background there).
    # 2026-09 dual-event: box + explicit outline renders as two ASS styles
    # (Box Layer 0 + outlined Default Layer 1). A single force_style box
    # would override both, so colors/box stay baked in the generated ASS and
    # force_style carries only placement (+ Fontsize/Bold, which apply to
    # both styles equally). All other combinations keep the exact historical
    # single-style force_style behavior byte-for-byte.
    dual_box_outline = bool(background_box) and (
        outline_width is not None or outline_color is not None
    )
    if background_box:
        if background_color is not None:
            normalized_bg = _normalize_background_color(background_color)
            ass_bg = _hex8_to_ass_backcolour(normalized_bg)
            # libass BorderStyle=3 renders the background box using OutlineColour
            # (NOT BackColour) and only extends the box beyond the glyphs when
            # Outline > 0. With Outline=0 the box is glyph-sized and hidden behind
            # the text, so set OutlineColour to the requested color with a small
            # Outline so the background box is actually visible. BackColour is set
            # for compatibility but the visible fill is OutlineColour.
            box_style = (
                f"BorderStyle=3,Outline={_BOX_OUTLINE_EXTENT},Shadow=0,"
                f"OutlineColour={ass_bg},BackColour={ass_bg}"
            )
        else:
            # Historical default: semi-transparent black box. Same mechanism
            # (OutlineColour + non-zero Outline) so it renders.
            box_style = (
                f"BorderStyle=3,Outline={_BOX_OUTLINE_EXTENT},"
                "Shadow=0,OutlineColour=&H80000000,BackColour=&H80000000"
            )
    elif outline_width is not None or outline_color is not None:
        # V2 outline override on the legacy ring path (docs/97 §19.17 Mục F):
        # explicit width/colour replace the historical Outline=2 black defaults;
        # absent fields keep those exact historical values byte-for-byte.
        ring_width = _validate_ring_outline_width(outline_px)
        ring_colour = (
            _hex_to_ass_primarycolour(_normalize_outline_color(outline_color))
            if outline_color is not None else "&H00000000"
        )
        box_style = (
            f"BorderStyle=1,Outline={ring_width},Shadow=0,"
            f"OutlineColour={ring_colour}"
        )
    else:
        box_style = "BorderStyle=1,Outline=2,Shadow=0"
    # Phase 3 additive typography (legacy path only): force_style Fontsize/Bold
    # (validated and frame-scaled above).
    style_parts = [f"Alignment={alignment}", f"MarginV={margin_v}", box_style]
    # PRESET-VIZ (docs/97 §19.16) additive: text_color (#RRGGBB / #RRGGBBAA,
    # opaque default) overrides the historical fixed &H00FFFFFF PrimaryColour
    # for the legacy force_style path. Absent → byte-identical historical
    # behavior. ASS/styled path is unaffected (the assigned SubtitleStyleSnapshot
    # owns the text color there).
    if text_color is not None:
        normalized_text = _normalize_text_color(text_color)
        style_parts.append(f"PrimaryColour={_hex_to_ass_primarycolour(normalized_text)}")
    if font_px is not None:
        style_parts.append(f"Fontsize={font_px}")
    if bold is not None:
        style_parts.append(f"Bold={-1 if bold else 0}")
    force_style = ",".join(style_parts)
    # PRESET-VIZ root cause (docs/97 §19.16): libass reads SRT/VTT with a fixed
    # PlayResY of 288, so a pixel-valued MarginV is mis-scaled and the subtitle
    # lands in the wrong vertical region. When the source subtitle file exists
    # we convert it to a temp ASS with PlayRes pinned to the video frame so
    # MarginV maps 1:1 to video pixels, then chain it under the mask exactly like
    # the ass path. When it is absent (unit tests, or a genuinely missing
    # artifact in production) we fall back to the historical direct-SRT filter,
    # which still fails closed at the ffmpeg layer when the file is missing.
    if os.path.exists(subtitle_path):
        # libass does not reliably honor MarginV from force_style for an ASS
        # input. Bake both placement fields into the generated Default style so
        # the converted SRT/VTT lands on the same scanline as the preset preview.
        # Dual-event colors ride in the ASS (force_style keeps placement only).
        ass_path = _srt_vtt_to_ass(
            subtitle_path,
            normalized_format,
            width,
            height,
            alignment=alignment,
            margin_v=margin_v,
            background_box=background_box,
            background_color=background_color,
            text_color=text_color,
            outline_width=outline_px,
            outline_color=outline_color,
        )
        # 2026-09 dual-event: the converted ASS already bakes Box + outlined
        # Default styles, so force_style carries placement (+ Fontsize/Bold,
        # which apply to both styles) — never box/PrimaryColour, which would
        # override both baked styles with one. Other combos keep force_style.
        ass_force_parts = [f"Alignment={alignment}", f"MarginV={margin_v}"]
        if font_px is not None:
            ass_force_parts.append(f"Fontsize={font_px}")
        if bold is not None:
            ass_force_parts.append(f"Bold={-1 if bold else 0}")
        ass_force_style = (
            ",".join(ass_force_parts) if dual_box_outline else force_style
        )
        if dual_box_outline:
            logger.info(
                "dual-event box+outline: colors baked in ASS, force_style keeps placement only"
            )
        try:
            escaped_ass = _escape_subtitles_path(ass_path)
            subtitle_filter = f"subtitles={escaped_ass}:force_style='{ass_force_style}'"
            cmd = [
                "ffmpeg",
                "-y",
                "-i", video_path,
                "-vf", _compose_vf(reframe_graph, _chain_mask(subtitle_filter, cover)),
                "-c:a", "copy",
                "-c:v", "libx264",
                "-preset", "fast",
                *_FASTSTART,
                output_path,
            ]
            _run(cmd, timeout=max(_DEFAULT_TIMEOUT, 1800))
        finally:
            try:
                os.remove(ass_path)
            except OSError:
                pass
    else:
        # Direct-SRT fallback (no converted ASS to carry two styles): a single
        # force_style cannot express box + outline together, so the box stays
        # authoritative and the outline is dropped with a warning. The converted
        # ASS path above renders both via dual-event instead.
        if dual_box_outline:
            logger.warning(
                "outline_width/outline_color ignored in box mode: the "
                "background box owns BorderStyle=3 extent/colour"
            )
        subtitle_filter = f"subtitles={escaped}:force_style='{force_style}'"
        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,
            "-vf", _compose_vf(reframe_graph, _chain_mask(subtitle_filter, cover)),
            "-c:a", "copy",
            "-c:v", "libx264",
            "-preset", "fast",
            *_FASTSTART,
            output_path,
        ]
        _run(cmd, timeout=max(_DEFAULT_TIMEOUT, 1800))


# Phase 4 mask geometry (docs/16 §7.1) + PRESET-VIZ (docs/97 §19.16):
# semantic percentages resolved against the probed frame; anchor=SUBTITLE
# centers the mask on the subtitle line; SOLID = drawbox (colorable),
# BLUR = boxblur region chained via split/crop/overlay — both ONE filtergraph
# with the subtitles filter, one encode pass. Contract formula:
#   maskW = round(W * widthPercent/100); maskH = round(H * heightPercent/100)
#   x = (W - maskW)/2; y = round(H * (line% - heightPercent/2)/100)
# paddingPercent is validated (0..10) but has NO geometric effect in v1 — it
# is reserved for the Spring-side feasibility estimate (text inside mask).
_MASK_ANCHOR_SUBTITLE = "SUBTITLE"
_MASK_STYLE_SOLID = "SOLID"
_MASK_STYLE_BLUR = "BLUR"
_MASK_BLUR_RADIUS_MIN = 2
_MASK_BLUR_RADIUS_MAX = 20
_MASK_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")

# OUTPUT-ASPECT (docs/97 §19.19): semantic output frames; ORIGINAL/None keeps
# the source frame. Blur-pad = the source fills the new frame as a zoomed,
# blurred background while an undistorted fit copy is centered on top — no
# content is cropped away (16:9 → 9:16 keeps the whole picture).
_OUTPUT_ASPECT_RATIOS = {"ORIGINAL", "16:9", "9:16", "4:3", "1:1"}
_ASPECT_RATIO_VALUES = {"16:9": 16 / 9, "9:16": 9 / 16, "4:3": 4 / 3, "1:1": 1.0}
_REFRAME_BG_BLUR_RADIUS = 24


def _validate_output_aspect_ratio(output_aspect_ratio: str | None) -> str | None:
    if output_aspect_ratio is None:
        return None
    normalized = str(output_aspect_ratio).upper().strip()
    if normalized in {"", "ORIGINAL"}:
        return None
    if normalized not in _OUTPUT_ASPECT_RATIOS:
        raise FFmpegError(
            f"output_aspect_ratio must be one of {sorted(_OUTPUT_ASPECT_RATIOS)}",
            "INVALID_INPUT",
            retryable=False,
        )
    return normalized


def _even_dim(value: int) -> int:
    # libx264 + yuv420p require even frame dimensions.
    even = int(value) - (int(value) % 2)
    return max(2, even)


def _reframe_target_dims(width: int, height: int,
                         output_aspect_ratio: str | None) -> tuple[int, int] | None:
    """Target (w, h) for the requested semantic frame, or None for identity.

    The frame never exceeds the source: a WIDER target keeps W (H = W/r_t);
    a TALLER target keeps H (W = H·r_t) — so the fitted foreground copy and
    the blurred background are both derived without upscaling (16:9 → 9:16
    keeps H and narrows W to 9:16 of it). Identity when the source ratio
    already matches (tolerance 1%). Both dims snap even (libx264/yuv420p).
    """
    normalized = _validate_output_aspect_ratio(output_aspect_ratio)
    if normalized is None or width <= 0 or height <= 0:
        return None
    target_ratio = _ASPECT_RATIO_VALUES[normalized]
    source_ratio = width / height
    if abs(source_ratio - target_ratio) / target_ratio < 0.01:
        return None
    if target_ratio > source_ratio:
        return _even_dim(width), _even_dim(round(width / target_ratio))
    return _even_dim(round(height * target_ratio)), _even_dim(height)


def _build_reframe_filter(width: int, height: int,
                          output_aspect_ratio: str | None) -> str | None:
    """Blur-pad reframe segments, chained FIRST in the -vf graph.

    Output ends UNLABELED so the cover chain (whose first filter takes an
    unlabeled input) or the subtitles filter links deterministically — one
    unlabeled boundary, one encode pass. Returns None for identity.
    """
    target = _reframe_target_dims(width, height, output_aspect_ratio)
    if target is None:
        return None
    out_w, out_h = target
    radius = _REFRAME_BG_BLUR_RADIUS
    return (
        f"split=2[rbg][rfg];"
        f"[rbg]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,"
        f"crop={out_w}:{out_h},"
        f"boxblur=luma_radius={radius}:luma_power=2[bg];"
        f"[rfg]scale={out_w}:{out_h}:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2"
    )


def _compose_vf(prefix: str | None, graph: str) -> str:
    """Join the optional reframe prefix with the cover+subtitles graph.

    In a simple filtergraph (-vf), FFmpeg requires exactly 1 input and 1 output.
    Because prefix ends with an unlabeled overlay output and graph begins with
    an unlabeled input, they must be joined with a comma (,) rather than a
    semicolon (;). A semicolon would start a new independent filter chain,
    causing FFmpeg to expect multiple inputs/outputs and fail with code 234.
    """
    if not prefix:
        return graph
    return f"{prefix},{graph}"

# V2 presentation layers (docs/97 §19.17 §B/§E): semantic-percent overlays
# sorted (zIndex ASC, id ASC) and chained UNDER the subtitles filter in one
# filtergraph / encode pass. Index-0 labels reuse the exact v1 mask names so a
# single-layer SUBTITLE payload produces a byte-identical filter string to the
# equivalent v1 mask payload.
_MAX_PRESENTATION_LAYERS = 4
_LAYER_TYPES = frozenset({"SOLID", "BLUR"})
_LAYER_ANCHORS = frozenset({"SUBTITLE", "TOP", "CENTER", "BOTTOM"})
_LAYER_ID_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_BOX_OUTLINE_EXTENT = 4
_RING_OUTLINE_WIDTH_MIN = 0
_RING_OUTLINE_WIDTH_MAX = 8


def _build_mask_filter(
    mask: dict,
    video_path: str,
    position: str,
    vertical_offset_percent: int,
    frame_size: tuple[int, int] | None = None,
) -> str:
    """Cover filter for the mask (drawbox or boxblur region), chained UNDER the
    subtitles filter by _chain_mask — subtitle always renders on top. Geometry
    resolves against `frame_size` when given (the OUTPUT-ASPECT target frame);
    otherwise the probed source frame."""
    normalized = _validate_mask(mask)
    width, height = frame_size if frame_size else (
        get_video_width(video_path), get_video_height(video_path))

    base_percent = {"TOP": 8, "CENTER": 50, "BOTTOM": 88}[(position or "BOTTOM").upper()]
    line_percent = max(3, min(95, base_percent + max(-30, min(30, int(vertical_offset_percent)))))

    mask_w = round(width * normalized["width_percent"] / 100)
    mask_h = round(height * normalized["height_percent"] / 100)
    x = round((width - mask_w) / 2)
    y = round(height * (line_percent - normalized["height_percent"] / 2) / 100)
    x = max(0, min(x, width - mask_w))
    y = max(0, min(y, height - mask_h))

    if normalized["style"] == _MASK_STYLE_BLUR:
        # One filtergraph, one encode pass: blur the full frame, crop the mask
        # region, overlay it back onto the original — the region under the
        # subtitle line is blurred while the rest stays sharp.
        radius = normalized["blur_radius"]
        return (
            f"split=2[orig][b];"
            f"[b]boxblur=luma_radius={radius}:luma_power=1:"
            f"chroma_radius={radius}:chroma_power=1[blurred];"
            f"[blurred]crop=w={mask_w}:h={mask_h}:x={x}:y={y}[bc];"
            f"[orig][bc]overlay=x={x}:y={y}"
        )
    color = normalized["color"]
    alpha = format(normalized["opacity_percent"] / 100.0, "g")
    # Absent color keeps the historical `black` literal (byte-identical legacy
    # filter string); an explicit hex is used verbatim.
    draw_color = color if color is not None else "black"
    return f"drawbox=x={x}:y={y}:w={mask_w}:h={mask_h}:t=fill:color={draw_color}@{alpha}"


def _validate_mask(mask: dict) -> dict:
    if not isinstance(mask, dict):
        raise FFmpegError("mask must be an object", "INVALID_INPUT", retryable=False)
    enabled = mask.get("enabled")
    if enabled is not True:
        raise FFmpegError("mask.enabled must be true (v1)", "INVALID_INPUT", retryable=False)
    if mask.get("anchor") != _MASK_ANCHOR_SUBTITLE:
        raise FFmpegError(
            f"mask.anchor must be {_MASK_ANCHOR_SUBTITLE} (v1)",
            "INVALID_INPUT",
            retryable=False,
        )
    width = mask.get("width_percent")
    height = mask.get("height_percent")
    opacity = mask.get("opacity_percent")
    padding = mask.get("padding_percent")
    if not (isinstance(width, int) and 20 <= width <= 100):
        raise FFmpegError(
            "mask.width_percent must be in [20..100]", "INVALID_INPUT", retryable=False
        )
    if not (isinstance(height, int) and 5 <= height <= 50):
        raise FFmpegError(
            "mask.height_percent must be in [5..50]", "INVALID_INPUT", retryable=False
        )
    if not (isinstance(opacity, int) and 0 <= opacity <= 100):
        raise FFmpegError(
            "mask.opacity_percent must be in [0..100]", "INVALID_INPUT", retryable=False
        )
    if not (isinstance(padding, int) and 0 <= padding <= 10):
        raise FFmpegError(
            "mask.padding_percent must be in [0..10]", "INVALID_INPUT", retryable=False
        )
    # PRESET-VIZ (docs/97 §19.16) additive v1.1: style/color/blurRadius —
    # defaults SOLID / #000000; BLUR requires radius 2..20; SOLID with a
    # radius is malformed (fail-closed, mirror of the Spring validator).
    style = mask.get("style") or _MASK_STYLE_SOLID
    if style not in {_MASK_STYLE_SOLID, _MASK_STYLE_BLUR}:
        raise FFmpegError(
            "mask.style must be SOLID or BLUR", "INVALID_INPUT", retryable=False
        )
    blur_radius = mask.get("blur_radius")
    if style == _MASK_STYLE_BLUR:
        if not (isinstance(blur_radius, int)
                and _MASK_BLUR_RADIUS_MIN <= blur_radius <= _MASK_BLUR_RADIUS_MAX):
            raise FFmpegError(
                f"mask.blur_radius must be in [{_MASK_BLUR_RADIUS_MIN}..{_MASK_BLUR_RADIUS_MAX}] "
                "for BLUR style",
                "INVALID_INPUT",
                retryable=False,
            )
    elif blur_radius is not None:
        raise FFmpegError(
            "mask.blur_radius is only allowed for BLUR style",
            "INVALID_INPUT",
            retryable=False,
        )
    color = mask.get("color")
    if color is not None and (not isinstance(color, str) or not _MASK_COLOR_PATTERN.match(color)):
        raise FFmpegError(
            "mask.color must be a #RRGGBB hex color", "INVALID_INPUT", retryable=False
        )
    return {
        "width_percent": width,
        "height_percent": height,
        "opacity_percent": opacity,
        "padding_percent": padding,
        "style": style,
        "blur_radius": blur_radius if style == _MASK_STYLE_BLUR else None,
        "color": color,
    }


def _validate_layers(layers: list[dict]) -> list[dict]:
    """Mirror of the Spring validator + pydantic wire models (§B): strict shape,
    type/style XOR, cap 4 — a malformed layer never reaches the filtergraph."""
    if not isinstance(layers, list) or not layers:
        raise FFmpegError(
            "layers must be a non-empty array", "INVALID_INPUT", retryable=False
        )
    if len(layers) > _MAX_PRESENTATION_LAYERS:
        raise FFmpegError(
            f"at most {_MAX_PRESENTATION_LAYERS} presentation layers are allowed",
            "INVALID_INPUT",
            retryable=False,
        )
    return [_validate_layer(layer) for layer in layers]


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_layer(layer: dict) -> dict:
    if not isinstance(layer, dict):
        raise FFmpegError("layer must be an object", "INVALID_INPUT", retryable=False)
    layer_id = layer.get("id")
    if (not isinstance(layer_id, str) or len(layer_id) > 64
            or not _LAYER_ID_PATTERN.fullmatch(layer_id)):
        raise FFmpegError(
            "layer.id must match ^[a-z0-9]+(-[a-z0-9]+)*$ (max 64 chars)",
            "INVALID_INPUT",
            retryable=False,
        )
    layer_type = layer.get("type")
    if layer_type not in _LAYER_TYPES:
        raise FFmpegError(
            "layer.type must be SOLID or BLUR", "INVALID_INPUT", retryable=False
        )
    if layer.get("enabled") is not True:
        raise FFmpegError(
            "layer.enabled must be true", "INVALID_INPUT", retryable=False
        )
    z_index = layer.get("z_index")
    if not _is_int(z_index):
        raise FFmpegError(
            "layer.z_index must be an integer", "INVALID_INPUT", retryable=False
        )
    anchor = layer.get("anchor")
    if anchor not in _LAYER_ANCHORS:
        raise FFmpegError(
            "layer.anchor must be one of SUBTITLE/TOP/CENTER/BOTTOM",
            "INVALID_INPUT",
            retryable=False,
        )
    geometry = layer.get("geometry")
    if not isinstance(geometry, dict):
        raise FFmpegError(
            "layer.geometry must be an object", "INVALID_INPUT", retryable=False
        )
    width = geometry.get("width_percent")
    height = geometry.get("height_percent")
    if not (_is_int(width) and 20 <= width <= 100):
        raise FFmpegError(
            "layer.geometry.width_percent must be in [20..100]",
            "INVALID_INPUT",
            retryable=False,
        )
    if not (_is_int(height) and 5 <= height <= 50):
        raise FFmpegError(
            "layer.geometry.height_percent must be in [5..50]",
            "INVALID_INPUT",
            retryable=False,
        )
    x_percent = geometry.get("x_percent")
    y_percent = geometry.get("y_percent")
    if x_percent is not None and not (_is_int(x_percent) and 0 <= x_percent <= 100):
        raise FFmpegError(
            "layer.geometry.x_percent must be in [0..100]",
            "INVALID_INPUT",
            retryable=False,
        )
    if y_percent is not None and not (_is_int(y_percent) and 0 <= y_percent <= 100):
        raise FFmpegError(
            "layer.geometry.y_percent must be in [0..100]",
            "INVALID_INPUT",
            retryable=False,
        )
    style = layer.get("style")
    if not isinstance(style, dict):
        raise FFmpegError(
            "layer.style must be an object", "INVALID_INPUT", retryable=False
        )
    color = style.get("color")
    opacity = style.get("opacity_percent")
    blur_radius = style.get("blur_radius")
    if layer_type == _MASK_STYLE_SOLID:
        if blur_radius is not None:
            raise FFmpegError(
                "SOLID layer must not carry blur_radius",
                "INVALID_INPUT",
                retryable=False,
            )
        if not (_is_int(opacity) and 0 <= opacity <= 100):
            raise FFmpegError(
                "SOLID layer requires opacity_percent in [0..100]",
                "INVALID_INPUT",
                retryable=False,
            )
        if color is not None and (
                not isinstance(color, str) or not _MASK_COLOR_PATTERN.match(color)):
            raise FFmpegError(
                "layer.style.color must be a #RRGGBB hex color",
                "INVALID_INPUT",
                retryable=False,
            )
    else:
        if color is not None or opacity is not None:
            raise FFmpegError(
                "BLUR layer must not carry color/opacity_percent",
                "INVALID_INPUT",
                retryable=False,
            )
        if not (_is_int(blur_radius)
                and _MASK_BLUR_RADIUS_MIN <= blur_radius <= _MASK_BLUR_RADIUS_MAX):
            raise FFmpegError(
                f"BLUR layer requires blur_radius in "
                f"[{_MASK_BLUR_RADIUS_MIN}..{_MASK_BLUR_RADIUS_MAX}]",
                "INVALID_INPUT",
                retryable=False,
            )
    return {
        "id": layer_id,
        "type": layer_type,
        "z_index": z_index,
        "anchor": anchor,
        "width_percent": width,
        "height_percent": height,
        "x_percent": x_percent,
        "y_percent": y_percent,
        "color": color,
        "opacity_percent": opacity,
        "blur_radius": blur_radius,
    }


def _layer_anchor_line_percent(anchor: str, position: str,
                               vertical_offset_percent: int) -> int:
    """Anchor scanline (F-09): TOP/CENTER/BOTTOM are independent fixed lines;
    SUBTITLE shares the effective subtitle line — identical base map + offset
    clamp [3,95] formula used for text placement and the v1 mask."""
    if anchor == _MASK_ANCHOR_SUBTITLE:
        base = {"TOP": 8, "CENTER": 50, "BOTTOM": 88}[(position or "BOTTOM").upper()]
        return max(3, min(95, base + max(-30, min(30, int(vertical_offset_percent)))))
    return {"TOP": 8, "CENTER": 50, "BOTTOM": 88}[anchor]


def _blur_labels(index: int) -> tuple[str, str, str, str]:
    # Index 0 keeps the exact v1 mask label names ([orig]/[b]/[blurred]/[bc])
    # so single-layer graphs stay byte-identical to the v1 mask filter string;
    # later layers suffix their labels to keep the graph unambiguous.
    if index == 0:
        return "[orig]", "[b]", "[blurred]", "[bc]"
    return f"[orig{index}]", f"[b{index}]", f"[blurred{index}]", f"[bc{index}]"


def _build_layer_filters(
    layers: list[dict],
    video_path: str,
    position: str,
    vertical_offset_percent: int,
    frame_size: tuple[int, int] | None = None,
) -> str:
    """V2 presentation overlay chain (docs/97 §19.17 §E). Layers sort by
    (zIndex ASC, id ASC); each renders as drawbox (SOLID) or split/boxblur/
    crop/overlay (BLUR) with the contract geometry
      layerW=round(W*wp/100) · layerH=round(H*hp/100)
      x=clamp(round((W−layerW)/2),0,W−layerW)
      y=clamp(round(H*(line−hp/2)/100),0,H−layerH)
    chained video → layers → subtitles (attached later by _chain_mask), one
    filtergraph / encode pass. The final output stays unlabeled so _chain_mask
    can append [m] + subtitles exactly like the v1 mask path. Geometry resolves
    against `frame_size` when given (the OUTPUT-ASPECT target frame)."""
    ordered = sorted(_validate_layers(layers),
                     key=lambda layer: (layer["z_index"], layer["id"]))
    width, height = frame_size if frame_size else (
        get_video_width(video_path), get_video_height(video_path))
    segments: list[str] = []
    for index, layer in enumerate(ordered):
        in_label = "" if index == 0 else f"[v{index}]"
        out_label = "" if index == len(ordered) - 1 else f"[v{index + 1}]"
        anchor_line_percent = _layer_anchor_line_percent(
            layer["anchor"], position, vertical_offset_percent)
        center_x_percent = (
            layer["x_percent"] if layer["x_percent"] is not None else 50
        )
        center_y_percent = (
            layer["y_percent"] if layer["y_percent"] is not None else anchor_line_percent
        )
        layer_w = round(width * layer["width_percent"] / 100)
        layer_h = round(height * layer["height_percent"] / 100)
        x = max(0, min(
            round(width * (center_x_percent - layer["width_percent"] / 2) / 100),
            width - layer_w,
        ))
        y = max(0, min(
            round(height * (center_y_percent - layer["height_percent"] / 2) / 100),
            height - layer_h,
        ))
        if layer["type"] == _MASK_STYLE_BLUR:
            orig, b, blurred, cropped = _blur_labels(index)
            radius = layer["blur_radius"]
            segments.append(
                f"{in_label}split=2{orig}{b};"
                f"{b}boxblur=luma_radius={radius}:luma_power=1:"
                f"chroma_radius={radius}:chroma_power=1{blurred};"
                f"{blurred}crop=w={layer_w}:h={layer_h}:x={x}:y={y}{cropped};"
                f"{orig}{cropped}overlay=x={x}:y={y}{out_label}"
            )
        else:
            alpha = format(layer["opacity_percent"] / 100.0, "g")
            draw_color = layer["color"] if layer["color"] is not None else "black"
            segments.append(
                f"{in_label}drawbox=x={x}:y={y}:w={layer_w}:h={layer_h}"
                f":t=fill:color={draw_color}@{alpha}{out_label}"
            )
    return ";".join(segments)


_TYPOGRAPHY_REFERENCE_HEIGHT = 1080


def _scale_to_frame(value: int | None, frame_height: int, *, minimum: int) -> int | None:
    """Scale a size authored for a 1080-line frame to ``frame_height`` pixels."""
    if value is None:
        return None
    return max(minimum, round(value * frame_height / _TYPOGRAPHY_REFERENCE_HEIGHT))


def _validate_ring_outline_width(outline_width: int | None) -> int:
    """Ring outline width 0..8 (wire contract §B); absent keeps the historical
    Outline=2 default byte-for-byte."""
    if outline_width is None:
        return 2
    if not _is_int(outline_width) or not (
            _RING_OUTLINE_WIDTH_MIN <= outline_width <= _RING_OUTLINE_WIDTH_MAX):
        raise FFmpegError(
            f"outline_width must be in "
            f"[{_RING_OUTLINE_WIDTH_MIN}..{_RING_OUTLINE_WIDTH_MAX}]",
            "INVALID_INPUT",
            retryable=False,
        )
    return outline_width


def _normalize_outline_color(color: str | None) -> str | None:
    """#RRGGBB only (mirror of the wire pattern); returns uppercase hex ready
    for ASS conversion. Absent stays absent (historical black default)."""
    if color is None:
        return None
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        raise FFmpegError(
            "outline_color must be a #RRGGBB hex color",
            "INVALID_INPUT",
            retryable=False,
        )
    return color.upper() + "FF"


def _normalize_background_color(color: str) -> str:
    """Accept #RRGGBBAA (upper/lower hex); rejects everything else fail-closed."""
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9A-Fa-f]{8}", color):
        raise FFmpegError(
            "background_color must be a #RRGGBBAA hex color",
            "INVALID_INPUT",
            retryable=False,
        )
    return color


def _hex8_to_ass_backcolour(hex8: str) -> str:
    """#RRGGBBAA → ASS &HAABBGGRR, inverting CSS opacity to ASS transparency."""
    rr = hex8[1:3]
    gg = hex8[3:5]
    bb = hex8[5:7]
    ass_alpha = 255 - int(hex8[7:9], 16)
    return f"&H{ass_alpha:02X}{bb.upper()}{gg.upper()}{rr.upper()}"


def _normalize_text_color(color: str) -> str:
    """Accept #RRGGBB (opaque) or #RRGGBBAA (with alpha); rejects everything
    else fail-closed. Returns #RRGGBBAA (CSS alpha defaults to FF for
    6-digit input, so text is opaque unless an explicit alpha is supplied)."""
    if not isinstance(color, str):
        raise FFmpegError(
            "text_color must be a #RRGGBB or #RRGGBBAA hex color",
            "INVALID_INPUT",
            retryable=False,
        )
    c = color.strip().upper()
    if re.fullmatch(r"#[0-9A-F]{6}", c):
        return c + "FF"
    if re.fullmatch(r"#[0-9A-F]{8}", c):
        return c
    raise FFmpegError(
        "text_color must be a #RRGGBB or #RRGGBBAA hex color",
        "INVALID_INPUT",
        retryable=False,
    )


def _hex_to_ass_primarycolour(hex8: str) -> str:
    """#RRGGBBAA → ASS &HAABBGGRR, inverting CSS opacity to ASS transparency."""
    rr = hex8[1:3]
    gg = hex8[3:5]
    bb = hex8[5:7]
    ass_alpha = 255 - int(hex8[7:9], 16)
    return f"&H{ass_alpha:02X}{bb.upper()}{gg.upper()}{rr.upper()}"


def _chain_mask(subtitle_filter: str, drawbox: str | None) -> str:
    """Chain drawbox (under) + subtitles (on top) in one filtergraph."""
    if drawbox is None:
        return subtitle_filter
    return f"{drawbox}[m];[m]{subtitle_filter}"


def mux_soft_subtitles(
    video_path: str,
    subtitle_path: str,
    output_path: str,
    lang: str = "und",
    output_aspect_ratio: str | None = None,
) -> None:
    """Mux a soft subtitle stream into MP4 (mov_text). With OUTPUT-ASPECT
    (docs/97 §19.19) the frame reframe forces a video re-encode (a stream copy
    cannot change geometry); identity keeps the historical copy mux."""
    reframe_graph = _build_reframe_filter(
        get_video_width(video_path), get_video_height(video_path), output_aspect_ratio)
    if reframe_graph:
        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,
            "-i", subtitle_path,
            "-vf", reframe_graph,
            "-c:v", "libx264",
            "-preset", "fast",
            "-c:a", "copy",
            "-c:s", "mov_text",
            "-metadata:s:s:0", f"language={lang}",
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-map", "1:0",
            *_FASTSTART,
            output_path,
        ]
    else:
        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,
            "-i", subtitle_path,
            "-c:v", "copy",
            "-c:a", "copy",
            "-c:s", "mov_text",
            "-metadata:s:s:0", f"language={lang}",
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-map", "1:0",
            *_FASTSTART,
            output_path,
        ]
    _run(cmd, timeout=max(_DEFAULT_TIMEOUT, 900))


def replace_audio(video_path: str, audio_path: str, output_path: str) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-i", video_path,
        "-i", audio_path,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        output_path,
    ]
    _run(cmd)


def get_media_info(path: str, timeout: int = 60) -> dict:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        path,
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError("ffprobe timed out", "RENDER_TIMEOUT", retryable=False) from exc
    except subprocess.CalledProcessError as exc:
        code, retryable = _classify_ffmpeg_error(exc.stderr or "")
        raise FFmpegError(exc.stderr or str(exc), code, retryable=retryable) from exc
    return json.loads(result.stdout)
