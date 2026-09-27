"""Place dubbed TTS clips on the subtitle timeline without losing speech.

Fitting every clip into its own subtitle window [start, end] (at most 1.2x
faster, then a hard cut) made the dub drop the tail of every long line, and
provider clips differ in level and carry their own leading/trailing silence.
The dub therefore sounded quiet in places, cut off in others, and silent where
padding ate the window. Clips are now:

1. trimmed of the provider's leading/trailing silence,
2. normalised to one speech loudness (peak-limited),
3. scheduled in order: a line may run on into the pause before the next
   subtitle, is sped up (pitch-preserving, bounded) only when it would not fit
   there, may start late when the previous line ran long, and is shortened with
   a fade only as a last resort when it would drift too far behind the video.
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

from pydub import AudioSegment
from pydub.silence import detect_leading_silence

from app.services.ffmpeg import _run

VOICE_TARGET_DBFS = -19.0
VOICE_PEAK_CEILING_DBFS = -1.0
MAX_NORMALIZE_GAIN_DB = 20.0
# Speech is detected relative to the clip's own peak so quiet providers are not trimmed away.
SILENCE_BELOW_PEAK_DB = 35.0
SILENCE_FLOOR_DBFS = -60.0
EDGE_KEEP_MS = 30
# Pitch-preserving speed-up stays intelligible up to about 1.35x.
MAX_FIT_TEMPO = 1.35
LINE_GAP_MS = 60
# How far a line may run behind the video before its tail is faded out.
MAX_LAG_MS = 1_200
TRUNCATE_FADE_MS = 120


@dataclass
class VoiceClip:
    segment_id: str
    start_ms: int
    end_ms: int
    audio: AudioSegment


@dataclass
class PlacedVoice:
    segment_id: str
    position_ms: int
    audio: AudioSegment

    @property
    def end_ms(self) -> int:
        return self.position_ms + len(self.audio)


def prepare_voice(audio: AudioSegment) -> AudioSegment:
    """Trim provider silence and bring the clip to the common speech loudness."""
    if len(audio) == 0 or audio.max_dBFS == float("-inf"):
        return audio
    threshold = max(SILENCE_FLOOR_DBFS, audio.max_dBFS - SILENCE_BELOW_PEAK_DB)
    lead = detect_leading_silence(audio, silence_threshold=threshold)
    tail = detect_leading_silence(audio.reverse(), silence_threshold=threshold)
    start = max(0, lead - EDGE_KEEP_MS)
    end = min(len(audio), len(audio) - tail + EDGE_KEEP_MS)
    if end - start > 0:
        audio = audio[start:end]

    loudness = audio.dBFS
    if loudness == float("-inf"):
        return audio
    gain = VOICE_TARGET_DBFS - loudness
    gain = max(-MAX_NORMALIZE_GAIN_DB, min(MAX_NORMALIZE_GAIN_DB, gain))
    gain = min(gain, VOICE_PEAK_CEILING_DBFS - audio.max_dBFS)
    return audio.apply_gain(gain) if abs(gain) >= 0.1 else audio


def schedule(clips: list[VoiceClip], timeline_end_ms: int, temp_dir: str) -> tuple[list[PlacedVoice], list[dict]]:
    """Return non-overlapping placements in subtitle order plus fitting warnings."""
    ordered = sorted(clips, key=lambda clip: (clip.start_ms, clip.end_ms))
    placed: list[PlacedVoice] = []
    warnings: list[dict] = []
    previous_end = None
    for index, clip in enumerate(ordered):
        audio = clip.audio
        if len(audio) == 0:
            continue
        cursor = clip.start_ms if previous_end is None else max(clip.start_ms, previous_end + LINE_GAP_MS)
        next_start = ordered[index + 1].start_ms if index + 1 < len(ordered) else max(clip.end_ms, timeline_end_ms)
        # The line owns its subtitle window plus the pause before the next subtitle.
        room = max(next_start - LINE_GAP_MS, clip.end_ms) - cursor
        if len(audio) > room:
            tempo = min(MAX_FIT_TEMPO, len(audio) / max(room, 1))
            if tempo > 1.01:
                audio = speed_up(audio, tempo, temp_dir)
        limit = room + MAX_LAG_MS
        if len(audio) > limit:
            warnings.append({
                "code": "AUDIO_TRUNCATED",
                "segment_id": clip.segment_id,
                "exceeded_ms": int(len(audio) - limit),
            })
            audio = audio[:max(limit, 1)].fade_out(min(TRUNCATE_FADE_MS, max(limit, 1)))
        elif len(audio) > room:
            warnings.append({
                "code": "AUDIO_DELAYED",
                "segment_id": clip.segment_id,
                "delay_ms": int(len(audio) - room),
            })
        placed.append(PlacedVoice(clip.segment_id, cursor, audio))
        previous_end = cursor + len(audio)
    return placed, warnings


def speed_up(audio: AudioSegment, tempo: float, temp_dir: str) -> AudioSegment:
    """Pitch-preserving ffmpeg atempo (single instance covers 0.5..2.0)."""
    source = os.path.join(temp_dir, f"fit_src_{uuid.uuid4()}.wav")
    target = os.path.join(temp_dir, f"fit_out_{uuid.uuid4()}.wav")
    audio.export(source, format="wav")
    _run(["ffmpeg", "-y", "-i", source, "-filter:a", f"atempo={tempo:.6f}", target])
    return AudioSegment.from_file(target)
