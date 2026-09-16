"""Generative summary V1 composition helpers (TASK 6).

Implements the TASK 6 pipeline segment:
  VISUAL BEATS → TTS → SOURCE VISUAL ASSIGNMENT → COMPOSE → SUMMARY MP4

* VisualBeat is the atomic unit: narrationSegment + visualDescription + sourceRange + visualStrategy + importance + generateTerms.
* LLM generates narrative with hook/context/key events/conclusion, grounded to transcript.
* TTS duration is source of truth — video beat duration is stretched to match TTS, never hard-coded.
* Composition: narration (concatenated TTS) + source visual (per-beat source range time-stretched) + captions (SRT from beats) + optional BGM.
* No VLM in this phase; text-grounded only.
* Fallback: LLM failure → keep extractive HYBRID path intact.

Worker helpers are pure ffmpeg composition — no DB, no provider lookup.
"""
from __future__ import annotations

import logging
import os
import re
import tempfile
import uuid
from dataclasses import dataclass
from typing import List

from app.services.ffmpeg import (
    CutRange,
    FFmpegError,
    VideoDurationProbe,
    _run,
    get_duration,
    probe_video_stream_duration,
    replace_audio,
    burn_subtitles,
    cut_and_concat_video,
)
from app.services.storage import get_storage


logger = logging.getLogger(__name__)


@dataclass
class VisualBeatInput:
    """Python mirror of Java VisualBeat for worker composition."""

    id: str
    narration_segment: str
    visual_description: str | None
    source_start_ms: int
    source_end_ms: int
    visual_strategy: str = "SOURCE_CUT"
    importance: float = 0.5
    generate_terms: List[str] | None = None
    tts_duration_ms: int | None = None  # TTS truth; None = use source natural duration
    generated_asset_path: str | None = None
    visual_evidence_refs: list[str] | None = None



def validate_extracted_clip_duration(
    clip_path: str,
    expected_duration_ms: int,
    tolerance_ms: int = 500,
    diagnostics: dict | None = None,
) -> None:
    """Validate extracted clip duration via ffprobe (M17.3-D)."""
    try:
        actual_s = get_duration(clip_path)
        actual_ms = int(actual_s * 1000)
        delta = abs(actual_ms - expected_duration_ms)
        if delta > tolerance_ms:
            failure_details = dict(diagnostics or {})
            failure_details["actualOutputDurationMs"] = actual_ms
            raise FFmpegError(
                f"Extracted clip duration mismatch: expected {expected_duration_ms}ms, got {actual_ms}ms (delta {delta}ms > {tolerance_ms}ms)",
                "VALIDATION_FAILED",
                retryable=False,
                details=failure_details or None,
            )
    except FFmpegError as exc:
        if diagnostics is None and exc.details is None:
            raise
        failure_details = dict(diagnostics or {})
        if exc.details:
            failure_details.update(exc.details)
        failure_details.setdefault("actualOutputDurationMs", None)
        raise FFmpegError(
            str(exc),
            exc.code,
            retryable=exc.retryable,
            details=failure_details,
        ) from exc
    except Exception as exc:
        failure_details = dict(diagnostics or {})
        failure_details["actualOutputDurationMs"] = None
        raise FFmpegError(
            f"Duration probe failed for {clip_path}: {exc}",
            "VALIDATION_FAILED",
            retryable=False,
            details=failure_details or None,
        ) from exc


def probe_source_duration(source_path: str) -> VideoDurationProbe:
    """Probe v:0 duration once; container duration is diagnostic only."""
    return probe_video_stream_duration(source_path)


def probe_source_duration_ms(source_path: str) -> int:
    """Compatibility wrapper returning the video-stream EOF in milliseconds."""
    return probe_source_duration(source_path).video_stream_end_ms


def _source_diagnostics(
    beat: VisualBeatInput,
    probe: VideoDurationProbe,
    target_ms: int,
    effective_start_ms: int | None = None,
    effective_end_ms: int | None = None,
) -> dict:
    details = {
        "beatId": beat.id,
        "requestedSourceRange": {
            "startMs": beat.source_start_ms,
            "endMs": beat.source_end_ms,
        },
        **probe.to_diagnostics(),
        "effectiveSourceRange": (
            {"startMs": effective_start_ms, "endMs": effective_end_ms}
            if effective_start_ms is not None and effective_end_ms is not None
            else None
        ),
        "targetTtsDurationMs": target_ms,
        "actualOutputDurationMs": None,
    }
    return details


def _source_probe_failure_details(beat: VisualBeatInput, probe_details: dict | None) -> dict:
    """Attach beat context when the one-per-render source probe fails."""
    details = {
        "beatId": beat.id,
        "requestedSourceRange": {
            "startMs": beat.source_start_ms,
            "endMs": beat.source_end_ms,
        },
        "durationAuthority": "VIDEO_STREAM",
        "containerDurationMs": None,
        "videoStreamStartMs": None,
        "videoStreamDurationMs": None,
        "videoStreamEndMs": None,
        "effectiveSourceRange": None,
        "targetTtsDurationMs": beat.tts_duration_ms,
        "actualOutputDurationMs": None,
    }
    if probe_details:
        details.update(probe_details)
    return details


def _with_source_probe_diagnostics(exc: FFmpegError, beat: VisualBeatInput) -> FFmpegError:
    return FFmpegError(
        str(exc),
        exc.code,
        retryable=exc.retryable,
        details=_source_probe_failure_details(beat, exc.details),
    )


def _validate_beats(beats: list[VisualBeatInput]) -> None:
    if not beats:
        raise FFmpegError("generative beats must be non-empty", "INVALID_INPUT", retryable=False)
    for beat in beats:
        if not beat.narration_segment or not beat.narration_segment.strip():
            raise FFmpegError(f"beat {beat.id} narrationSegment must be non-blank", "INVALID_INPUT", retryable=False)
        if beat.source_end_ms <= beat.source_start_ms:
            raise FFmpegError(f"beat {beat.id} sourceRange must have positive duration", "INVALID_INPUT", retryable=False)
        if beat.source_start_ms < 0:
            raise FFmpegError(f"beat {beat.id} sourceRange must not be negative", "INVALID_INPUT", retryable=False)
        if beat.tts_duration_ms is None or beat.tts_duration_ms <= 0:
            raise FFmpegError(
                f"beat {beat.id} requires a positive measured tts_duration_ms",
                "INVALID_INPUT",
                retryable=False,
            )
        if beat.generate_terms and not (5 <= len(beat.generate_terms) <= 8):
            raise FFmpegError(f"beat {beat.id} generate_terms must be 5–8 when present", "INVALID_INPUT", retryable=False)
    # Beat isolation: narration of Beat N must not spill into Beat N+1's visual.
    # Distant source ranges overlapping heavily across beats indicate a planning
    # error (future-event leakage). Worker executes deterministically and fails
    # closed instead of silently merging/spilling narration.
    for prev, nxt in zip(beats, beats[1:]):
        if nxt.source_start_ms < prev.source_end_ms:
            overlap = prev.source_end_ms - nxt.source_start_ms
            # Sequential grounded beats must not share footage beyond a tiny
            # edit tolerance (1500ms, same as visual gap). Larger overlaps mean
            # Beat N+1 replays footage while Beat N narration still runs.
            if overlap > 1500:
                raise FFmpegError(
                    f"beats {prev.id} and {nxt.id} overlap by {overlap}ms: "
                    "narration must stay within its own visual beat",
                    "INVALID_INPUT",
                    retryable=False,
                )


def _extract_and_rescale_beat(
    source_path: str,
    beat: VisualBeatInput,
    output_path: str,
    temp_dir: str,
    physical_source_duration_ms: int | None = None,
    source_duration_probe: VideoDurationProbe | None = None,
) -> None:
    """Extract a source range whose rendered duration is the measured TTS duration.

    TTS is the beat/timeline authority. A missing/non-positive measurement is
    invalid; the source range is never used as a duration fallback. The source
    range is time-stretched when necessary (or padded with the last frame when
    the narration is longer), but it never extends the beat beyond measured TTS.
    """
    if beat.tts_duration_ms is None or beat.tts_duration_ms <= 0:
        raise FFmpegError(
            f"beat {beat.id} requires a positive measured tts_duration_ms",
            "INVALID_INPUT",
            retryable=False,
        )
    tts_dur_ms = beat.tts_duration_ms
    target_ms = tts_dur_ms

    # M17.3-B: Generated image visual strategy (no source video required)
    if beat.visual_strategy in ("GENERATED_IMAGE", "GENERATED") and getattr(beat, "generated_asset_path", None) and os.path.exists(beat.generated_asset_path):
        target_s = target_ms / 1000.0
        cmd_img = [
            "ffmpeg",
            "-y",
            "-loop", "1",
            "-i", beat.generated_asset_path,
            "-t", str(target_s),
            "-vf", "scale='if(gt(iw,ih),1024,-2)':'if(gt(iw,ih),-2,576)':force_original_aspect_ratio=decrease,pad=1024:576:(ow-iw)/2:(oh-ih)/2,fps=30",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            output_path,
        ]
        _run(cmd_img)
        validate_extracted_clip_duration(output_path, target_ms, tolerance_ms=500)
        return

    if source_duration_probe is None:
        if physical_source_duration_ms is None:
            source_duration_probe = probe_source_duration(source_path)
        else:
            # Preserve the old direct-call seam for tests/callers that already
            # supplied an explicit duration, while marking the evidence source.
            source_duration_probe = VideoDurationProbe(
                container_duration_ms=None,
                video_stream_start_ms=0,
                video_stream_duration_ms=physical_source_duration_ms,
                video_stream_end_ms=physical_source_duration_ms,
                duration_source="caller_supplied",
            )

    video_stream_end_ms = source_duration_probe.video_stream_end_ms
    # DB metadata may extend past the physical video stream. Clamp only the
    # source range; the resulting real footage is still fitted to TTS below.
    effective_start_ms = max(beat.source_start_ms, source_duration_probe.video_stream_start_ms)
    effective_end_ms = min(beat.source_end_ms, video_stream_end_ms)
    source_duration_ms = effective_end_ms - effective_start_ms
    if source_duration_ms <= 0:
        raise FFmpegError(
            f"beat {beat.id} has no physical source frames in "
            f"[{beat.source_start_ms},{beat.source_end_ms}) with EOF "
            f"{video_stream_end_ms}ms",
            "GENERATIVE_SOURCE_RANGE_OUT_OF_BOUNDS",
            retryable=False,
            details=_source_diagnostics(
                beat, source_duration_probe, target_ms, effective_start_ms, effective_end_ms
            ),
        )

    source_details = _source_diagnostics(
        beat, source_duration_probe, target_ms, effective_start_ms, effective_end_ms
    )
    # stream.start_time is an absolute timestamp in the source timeline, while
    # input -ss is an offset from the input's start. Keep the diagnostics in the
    # source timeline, but convert only the seek argument to the input-relative
    # coordinate system.
    seek_offset_ms = max(
        0,
        min(
            source_duration_probe.video_stream_duration_ms,
            effective_start_ms - source_duration_probe.video_stream_start_ms,
        ),
    )
    source_details["seekOffsetMs"] = seek_offset_ms
    src_s = f"{source_duration_ms / 1000.0:.6f}"
    target_s = f"{target_ms / 1000.0:.6f}"

    # Every source branch follows the same invariant:
    #   trim source range -> reset PTS -> optional speed-fit -> over-pad with
    #   the final frame -> trim exactly to TTS -> fps.
    # The first fps regularizes frame durations before tpad. FFmpeg's trim
    # output can carry zero-duration frame metadata, which otherwise prevents
    # tpad from emitting the cloned tail on VFR/tail-frame inputs. The final
    # trim remains the single duration authority; over-padding makes it
    # resilient to frame-tail/timestamp under-reporting.
    filter_chain = [f"trim=duration={src_s}", "setpts=PTS-STARTPTS"]
    if target_ms < source_duration_ms:
        factor = target_ms / source_duration_ms
        filter_chain.append(f"setpts={factor:.9f}*PTS")
    filter_chain.append("fps=30")
    filter_chain.append(f"tpad=stop_mode=clone:stop_duration={target_s}")
    filter_chain.extend([f"trim=duration={target_s}", "fps=30"])
    source_details["sourceFilter"] = ",".join(filter_chain)
    source_details["outputDurationAuthority"] = "FILTER_TRIM"
    logger.info(
        "Generative beat render beat=%s requested=%s effective=%s seekOffsetMs=%s "
        "sourceDurationMs=%s targetTtsDurationMs=%s filter=%s",
        beat.id,
        source_details["requestedSourceRange"],
        source_details["effectiveSourceRange"],
        seek_offset_ms,
        source_duration_ms,
        target_ms,
        source_details["sourceFilter"],
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-ss", f"{seek_offset_ms / 1000.0:.6f}",
        "-i", source_path,
        "-vf", ",".join(filter_chain),
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-reset_timestamps", "1",
        output_path,
    ]
    try:
        _run(cmd)
    except FFmpegError as exc:
        failure_details = dict(source_details)
        if exc.details:
            failure_details.update(exc.details)
        raise FFmpegError(
            str(exc),
            exc.code,
            retryable=exc.retryable,
            details=failure_details,
        ) from exc
    validate_extracted_clip_duration(
        output_path, target_ms, tolerance_ms=500, diagnostics=source_details
    )


def compose_generative_summary(
    source_video_path: str,
    beats: list[VisualBeatInput],
    tts_audio_paths: list[str],
    output_path: str,
    temp_dir: str,
    *,
    caption_srt_path: str | None = None,
) -> str:
    """Compose the generative summary MP4 from beats + TTS audios.

    Pipeline for V1 text-grounded generative:
      1. For each beat, extract source visual range and rescale its duration to
         the beat's TTS duration (TTS truth). Concatenate all beat visuals in order.
      2. Concatenate all TTS audios in beat order to form narration track.
      3. Mux narration onto concatenated video.
      4. Burn captions from caption_srt_path if provided (narration text time-aligned
         to beat TTS durations).

    Returns the final video path (output_path).
    """
    _validate_beats(beats)
    if len(beats) != len(tts_audio_paths):
        raise FFmpegError("beats and tts_audio_paths must have same length", "INVALID_INPUT", retryable=False)

    # 1) Build per-beat video segments with TTS-driven duration. Probe the
    # physical source once; each beat clamps its DB range against this value.
    try:
        source_duration_probe = probe_source_duration(source_video_path)
    except FFmpegError as exc:
        raise _with_source_probe_diagnostics(exc, beats[0]) from exc
    beat_video_paths: list[str] = []
    for beat in beats:
        beat_path = os.path.join(temp_dir, f"beat_{beat.id}.mp4")
        _extract_and_rescale_beat(
            source_video_path,
            beat,
            beat_path,
            temp_dir,
            source_duration_probe=source_duration_probe,
        )
        beat_video_paths.append(beat_path)

    # Concat beat videos via ffmpeg concat demuxer (re-encode already done per beat)
    concat_list = os.path.join(temp_dir, "generative_concat_list.txt")
    with open(concat_list, "w", encoding="utf-8") as f:
        for p in beat_video_paths:
            escaped = p.replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")
    concat_video = os.path.join(temp_dir, "generative_concat.mp4")
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_list,
        "-c", "copy",
        concat_video,
    ]
    _run(cmd)

    # 2) Concatenate the measured TTS files as-is. Never pad audio to the
    # natural source range: the measured TTS durations define beat boundaries.
    concat_audio = os.path.join(temp_dir, "generative_narration.wav")
    audio_list = os.path.join(temp_dir, "audio_concat_list.txt")
    with open(audio_list, "w", encoding="utf-8") as f:
        for p in tts_audio_paths:
            escaped = p.replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")
    cmd_audio = [
        "ffmpeg",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", audio_list,
        "-c", "copy",
        concat_audio,
    ]
    _run(cmd_audio)

    # 3) Mux narration onto video
    muxed = os.path.join(temp_dir, "with_narration.mp4")
    replace_audio(concat_video, concat_audio, muxed)

    # 4) Burn captions if provided
    if caption_srt_path and os.path.exists(caption_srt_path):
        burn_subtitles(
            muxed,
            caption_srt_path,
            output_path,
            position="BOTTOM",
            vertical_offset_percent=0,
            background_box=True,
            subtitle_format="srt",
        )
    else:
        # No captions — just move muxed to output
        import shutil
        shutil.copyfile(muxed, output_path)

    return output_path


# ── Sentence-level SRT (Option A proportional timing) ───────────────────
# Beat TTS remains the authoritative audio timing; sentences are a presentation
# layer only. No additional TTS calls. Locked decisions: wrapper failures and
# cues longer than 7s fail validation (no silent corruption); the worker never
# dedups narration (backend-ai validator owns rejection).

_CUE_MAX_CHARS = 80
_CUE_MAX_LINES = 2
_CUE_MAX_CPS = 20.0
_CUE_MAX_MS = 7000
_CUE_WRAP_SINGLE_LINE = 42

_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "st", "tp", "ts", "ths", "vd", "vs",
    "anh", "chi", "em", "ong", "ba", "co", "chu", "bk",
}

_SENTENCE_BOUNDARY_RE = re.compile(
    r"(?:(?P<term_cjk>[。！？]+[\"'”’)\]}]*)(?P<sep_cjk>\s*|$)(?=(?P<next_cjk>[\"'“‘(\[]?[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afA-Za-z0-9]|$)))|"
    r"(?:(?P<term_latin>[.!?…]+[\"'”’)\]}]*)(?P<sep_latin>\s+|$)(?=(?P<next_latin>[\"'“‘(\[]?[A-ZÀ-Ỹ0-9]|$)))"
)


def _is_abbreviation(text: str, term_start: int) -> bool:
    m = re.search(r"([A-Za-zÀ-ỹ]+)$", text[:term_start])
    if not m:
        return False
    return m.group(1).lower() in _ABBREVIATIONS


def _is_decimal_point(text: str, term_start: int, term_end: int) -> bool:
    if term_end - term_start != 1 or text[term_start] != ".":
        return False
    before = text[term_start - 1] if term_start > 0 else ""
    after = text[term_end] if term_end < len(text) else ""
    return before.isdigit() and after.isdigit()


def split_beat_sentences(text: str | None) -> list[str]:
    """Worker-local sentence split (mirror of backend-ai splitter, DB-free)."""
    if text is None:
        return []
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []
    sentences: list[str] = []
    start = 0
    for m in _SENTENCE_BOUNDARY_RE.finditer(normalized):
        is_cjk = bool(m.group("term_cjk"))
        term_group = "term_cjk" if is_cjk else "term_latin"
        sep_group = "sep_cjk" if is_cjk else "sep_latin"
        term_start = m.start(term_group)
        term_end = m.start(sep_group)
        if not is_cjk and _is_decimal_point(normalized, term_start, term_end):
            continue
        if not is_cjk and _is_abbreviation(normalized, term_start):
            continue
        end = m.end(term_group)
        sentence = normalized[start:end].strip()
        if sentence:
            sentences.append(sentence)
        start = m.end()
    tail = normalized[start:].strip()
    if tail:
        sentences.append(tail)
    if len(sentences) == 1 and "\n" in sentences[0]:
        parts = [p.strip() for p in sentences[0].split("\n") if p.strip()]
        if len(parts) > 1:
            return parts
    return sentences


def wrap_sentence_to_lines(sentence: str) -> str:
    """Wrap one sentence into <=2 lines without cutting words.

    Raises FFmpegError INVALID_INPUT when the sentence cannot fit within
    _CUE_MAX_CHARS without semantic corruption (fail-closed, no truncation).
    """
    text = " ".join(sentence.split())
    if len(text) <= _CUE_MAX_CHARS:
        if len(text) <= _CUE_WRAP_SINGLE_LINE:
            return text
        # Prefer a punctuation boundary near the middle, else whitespace.
        mid = len(text) // 2
        punct_positions = [m.start() + 1 for m in re.finditer(r"[,;:—–\-…]\s", text)]
        candidates = [p for p in punct_positions if 0 < p < len(text)]
        split_at: int | None = None
        if candidates:
            split_at = min(candidates, key=lambda p: abs(p - mid))
        if split_at is None:
            spaces = [m.start() for m in re.finditer(r"\s", text)]
            if spaces:
                split_at = min(spaces, key=lambda p: abs(p - mid))
        if split_at is not None:
            first, second = text[:split_at].strip(), text[split_at:].strip()
            if first and second and len(first) <= _CUE_MAX_CHARS and len(second) <= _CUE_MAX_CHARS:
                return f"{first}\n{second}"
        return text
    raise FFmpegError(
        f"sentence exceeds {_CUE_MAX_CHARS} chars and cannot be wrapped "
        "without splitting words",
        "INVALID_INPUT",
        retryable=False,
    )


def allocate_sentence_durations(sentences: list[str], total_ms: int) -> list[int]:
    """Allocate beat TTS duration proportionally to char counts (Option A).

    Deterministic integer rounding; the rounding remainder goes to the final
    cue so the sum equals total_ms exactly.
    """
    if not sentences:
        raise FFmpegError("no sentences to allocate", "INVALID_INPUT", retryable=False)
    if total_ms <= 0:
        raise FFmpegError("beat duration must be > 0", "INVALID_INPUT", retryable=False)
    weights = [max(1, len(s)) for s in sentences]
    grand = sum(weights)
    durations = [(w * total_ms) // grand for w in weights]
    for i, d in enumerate(durations):
        if d <= 0:
            durations[i] = 1
    remainder = total_ms - sum(durations)
    durations[-1] += remainder
    if durations[-1] <= 0:
        raise FFmpegError(
            "beat duration too short for sentence count",
            "INVALID_INPUT",
            retryable=False,
        )
    return durations


def _check_sentence_cue(text: str, duration_ms: int) -> None:
    lines = text.split("\n")
    chars = sum(len(line) for line in lines)
    if chars > _CUE_MAX_CHARS:
        raise FFmpegError(
            f"cue exceeds {_CUE_MAX_CHARS} chars ({chars})",
            "INVALID_INPUT",
            retryable=False,
        )
    if len(lines) > _CUE_MAX_LINES:
        raise FFmpegError(
            f"cue exceeds {_CUE_MAX_LINES} lines",
            "INVALID_INPUT",
            retryable=False,
        )
    if duration_ms > _CUE_MAX_MS:
        raise FFmpegError(
            f"cue duration {duration_ms}ms exceeds {_CUE_MAX_MS}ms cap",
            "INVALID_INPUT",
            retryable=False,
        )
    if duration_ms <= 0:
        raise FFmpegError("cue duration must be > 0", "INVALID_INPUT", retryable=False)
    cps = chars / (duration_ms / 1000.0)
    if cps > _CUE_MAX_CPS + 1e-9:
        raise FFmpegError(
            f"cue CPS {cps:.1f} exceeds {_CUE_MAX_CPS:g}",
            "INVALID_INPUT",
            retryable=False,
        )
    for line in lines:
        if not line.strip():
            raise FFmpegError("cue contains a blank line", "INVALID_INPUT", retryable=False)


def build_beat_srt(
    beats: list[VisualBeatInput],
    output_path: str,
) -> str:
    """Build a sentence-level SRT file time-aligned to measured TTS durations.

    One beat → N sentence cues (Option A proportional timing). The beat's
    tts_duration_ms stays the source of truth: sentence cues partition it
    exactly with a continuous cursor, no gaps, no overlaps. Audio untouched.
    """
    _validate_beats(beats)
    with open(output_path, "w", encoding="utf-8") as out:
        cursor_ms = 0
        cue_idx = 0

        def fmt(ms: int) -> str:
            s, ms = divmod(ms, 1000)
            m, s = divmod(s, 60)
            h, m = divmod(m, 60)
            return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

        for beat in beats:
            tts_dur_ms = beat.tts_duration_ms
            sentences = split_beat_sentences(beat.narration_segment)
            if not sentences:
                raise FFmpegError(
                    f"beat {beat.id} produced no sentences",
                    "INVALID_INPUT",
                    retryable=False,
                )
            cue_durations = allocate_sentence_durations(sentences, tts_dur_ms)
            beat_start_ms = cursor_ms
            for sentence, cue_dur in zip(sentences, cue_durations):
                wrapped = wrap_sentence_to_lines(sentence)
                _check_sentence_cue(wrapped, cue_dur)
                # No word/token cut: wrapped lines must reassemble the sentence.
                if " ".join(wrapped.split()) != " ".join(sentence.split()):
                    raise FFmpegError(
                        f"beat {beat.id} cue corrupted sentence tokens",
                        "INVALID_INPUT",
                        retryable=False,
                    )
                cue_idx += 1
                start_ms = cursor_ms
                end_ms = cursor_ms + cue_dur
                cursor_ms = end_ms
                out.write(f"{cue_idx}\n")
                out.write(f"{fmt(start_ms)} --> {fmt(end_ms)}\n")
                out.write(f"{wrapped}\n\n")
            # Cursor follows TTS, never the natural source range.
            cursor_ms = beat_start_ms + tts_dur_ms
    return output_path


def build_generative_artifact_meta(
    beats: list[VisualBeatInput],
    total_duration_ms: int,
    tts_durations: list[int],
) -> dict:
    """Build deterministic artifact metadata for the generative composition."""
    return {
        "beats": len(beats),
        "total_duration_ms": total_duration_ms,
        "tts_durations_ms": tts_durations,
        "beat_ids": [b.id for b in beats],
        "visual_strategies": [b.visual_strategy for b in beats],
        "composition": "generative_v1_text_grounded",
        "tts_is_source_of_truth": True,
    }
