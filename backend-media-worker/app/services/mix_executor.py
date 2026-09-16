"""Execute engine-neutral MixPlan V1 into a mixed WAV (CT8).

Worker rules:
- Execute the plan only — no DB, Strategy, Recipe, Provider, or GPU lookup.
- Do not invent inputs; fail closed on invalid plan structure.
- Phase 5 (docs/62 §2): optional TTS_SEGMENT `tempo` (0.8..1.2) is applied as
  deterministic pitch-preserving atempo BEFORE the trim/pad fit — the slot
  window [start_ms, end_ms] remains the alignment authority and tempo is the
  only speed control in the mix path (legacy fit_dub_audio is untouched).
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any

from pydub import AudioSegment

from app.services.ffmpeg import FFmpegError, _local_tts_path, _run, get_duration
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

_SUPPORTED_PLAN_VERSION = 1
_SUPPORTED_INPUT_ROLES = {
    "ORIGINAL_MIX",
    "STEM_MUSIC",
    "STEM_VOCAL",
    "STEM_EFFECTS",
    "TTS_SEGMENT",
}
_TEMPO_MIN = 0.8
_TEMPO_MAX = 1.2


def execute_mix_plan(mix_plan: dict[str, Any], temp_dir: str) -> tuple[str, int, list[dict]]:
    """Compile MixPlan → mixed WAV path, duration_ms, warnings."""
    warnings: list[dict] = []
    _validate_plan(mix_plan)

    storage = get_storage()
    inputs_by_id: dict[str, dict[str, Any]] = {}
    loaded: dict[str, AudioSegment] = {}

    for raw in mix_plan.get("inputs") or []:
        input_id = raw["input_id"]
        inputs_by_id[input_id] = raw
        role = raw["role"]
        audio_ref = raw["audio_ref"]
        local = os.path.join(temp_dir, f"in_{input_id.replace('/', '_')}")
        if role == "TTS_SEGMENT":
            local = _local_tts_path(temp_dir, raw.get("segment_id") or input_id, audio_ref)
        storage.download(audio_ref, local)
        # Phase 5 (docs/62 §2): tempo BEFORE gain/fade/fit — pitch-preserving
        # atempo; the slot window stays the alignment authority (trim/pad after).
        tempo = raw.get("tempo")
        if role == "TTS_SEGMENT" and tempo is not None and abs(float(tempo) - 1.0) > 1e-9:
            local = _apply_tempo(local, float(tempo), temp_dir)
        segment = AudioSegment.from_file(local)
        segment = _apply_gain(segment, float(raw.get("gain_db") or 0.0))
        fade_in = int(raw.get("fade_in_ms") or 0)
        fade_out = int(raw.get("fade_out_ms") or 0)
        if fade_in > 0:
            segment = segment.fade_in(fade_in)
        if fade_out > 0:
            segment = segment.fade_out(fade_out)
        loaded[input_id] = segment

    bed_ids = [i["input_id"] for i in mix_plan["inputs"] if i["role"] != "TTS_SEGMENT"]
    if not bed_ids:
        raise FFmpegError("MixPlan has no bed/stem inputs", "INVALID_INPUT", retryable=False)

    # Build bed: sum non-TTS inputs (music + effects + muted vocal, etc.)
    bed: AudioSegment | None = None
    for bed_id in bed_ids:
        piece = loaded[bed_id]
        offset = int(inputs_by_id[bed_id].get("offset_ms") or 0)
        if offset > 0:
            piece = AudioSegment.silent(duration=offset) + piece
        if bed is None:
            bed = piece
        else:
            # Overlay onto longer canvas
            if len(piece) > len(bed):
                bed = bed + AudioSegment.silent(duration=len(piece) - len(bed))
            bed = bed.overlay(piece)
    assert bed is not None

    ducking = mix_plan.get("ducking") or {"kind": "NONE"}
    kind = (ducking.get("kind") or "NONE").upper()
    speech_ids = list(ducking.get("speech_input_ids") or [])
    tts_inputs = [i for i in mix_plan["inputs"] if i["role"] == "TTS_SEGMENT"]

    speech_inputs = [item for item in tts_inputs if item["input_id"] in speech_ids]
    if kind in {"WHOLE_MIX", "STEM_AWARE"} and speech_inputs:
        duck_gain_db = float(ducking.get("duck_gain_db") or -12.0)
        attack_ms = int(ducking.get("attack_ms") or 50)
        release_ms = int(ducking.get("release_ms") or 200)
        target_id = ducking.get("target_input_id")
        # Whole-mix: duck entire bed under each TTS window (speech may bleed).
        # Stem-aware: same gain automation on the assembled bed (music-led).
        for tts in speech_inputs:
            start = int(tts.get("start_ms") or 0)
            end = int(tts.get("end_ms") or start)
            if end <= start:
                warnings.append({
                    "code": "EMPTY_TTS_WINDOW",
                    "message": "TTS window has non-positive duration",
                    "input_id": tts.get("input_id"),
                })
                continue
            bed = _duck_region(bed, start, end, duck_gain_db, attack_ms, release_ms)
        if target_id and target_id not in loaded:
            warnings.append({
                "code": "DUCK_TARGET_MISSING_LOCAL",
                "message": f"duck target {target_id} not in loaded inputs (bed already assembled)",
                "input_id": target_id,
            })

    # Overlay TTS segments at timeline positions
    for tts in tts_inputs:
        input_id = tts["input_id"]
        start = int(tts.get("start_ms") or 0)
        end = int(tts.get("end_ms") or start)
        tts_audio = loaded[input_id]
        target_ms = max(0, end - start)
        if target_ms > 0 and len(tts_audio) > 0:
            # Fit roughly to window without cross-service stretch policy (CT8 simple).
            if abs(len(tts_audio) - target_ms) > 5:
                # pad or trim
                if len(tts_audio) > target_ms:
                    tts_audio = tts_audio[:target_ms]
                else:
                    tts_audio = tts_audio + AudioSegment.silent(duration=target_ms - len(tts_audio))
        if start + len(tts_audio) > len(bed):
            bed = bed + AudioSegment.silent(duration=start + len(tts_audio) - len(bed))
        bed = bed.overlay(tts_audio, position=start)

    output = mix_plan.get("output") or {}
    fmt = (output.get("format") or "wav").lower()
    sample_rate = int(output.get("sample_rate_hz") or 48000)
    channels = int(output.get("channels") or 2)
    bed = bed.set_frame_rate(sample_rate).set_channels(channels)

    output_path = os.path.join(temp_dir, f"mixed_audio.{fmt}")
    bed.export(output_path, format=fmt)
    duration_ms = int(get_duration(output_path) * 1000)
    return output_path, duration_ms, warnings


def _validate_plan(mix_plan: dict[str, Any]) -> None:
    if not isinstance(mix_plan, dict):
        raise FFmpegError("mix_plan must be an object", "INVALID_INPUT", retryable=False)
    version = mix_plan.get("plan_version")
    if version != _SUPPORTED_PLAN_VERSION:
        raise FFmpegError(
            f"Unsupported mix plan_version: {version}",
            "INVALID_INPUT",
            retryable=False,
        )
    inputs = mix_plan.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        raise FFmpegError("mix_plan.inputs required", "INVALID_INPUT", retryable=False)
    ids: set[str] = set()
    for raw in inputs:
        if not isinstance(raw, dict):
            raise FFmpegError("mix_plan input must be object", "INVALID_INPUT", retryable=False)
        input_id = raw.get("input_id")
        audio_ref = raw.get("audio_ref")
        role = raw.get("role")
        if not input_id or not audio_ref or not role:
            raise FFmpegError("input_id/role/audio_ref required", "INVALID_INPUT", retryable=False)
        if "/" in str(input_id) or "\\" in str(input_id) or ".." in str(input_id):
            raise FFmpegError("input_id must not contain path separators or traversal", "INVALID_INPUT", retryable=False)
        if input_id in ids:
            raise FFmpegError(f"duplicate input_id {input_id}", "INVALID_INPUT", retryable=False)
        ids.add(input_id)
        if role not in _SUPPORTED_INPUT_ROLES:
            raise FFmpegError(f"unsupported input role {role}", "INVALID_INPUT", retryable=False)
        # Reject filesystem path assumptions
        if str(audio_ref).startswith("/") or "\\" in str(audio_ref):
            raise FFmpegError(
                f"audio_ref must be opaque bucket/key for {input_id}",
                "INVALID_INPUT",
                retryable=False,
            )
        if role == "TTS_SEGMENT":
            segment_id = raw.get("segment_id")
            if not segment_id or "/" in str(segment_id) or "\\" in str(segment_id) or ".." in str(segment_id):
                raise FFmpegError("TTS segment_id must not contain path separators or traversal", "INVALID_INPUT", retryable=False)
            # Phase 5 (docs/62 §2): tempo is TTS_SEGMENT-only and bounded to
            # 0.8..1.2 in v1 — anything else fails closed.
            tempo = raw.get("tempo")
            if tempo is not None:
                try:
                    tempo_value = float(tempo)
                except (TypeError, ValueError):
                    raise FFmpegError(
                        "tempo must be a number", "INVALID_INPUT", retryable=False
                    )
                if not (_TEMPO_MIN <= tempo_value <= _TEMPO_MAX):
                    raise FFmpegError(
                        f"tempo must be in [{_TEMPO_MIN}..{_TEMPO_MAX}]",
                        "INVALID_INPUT",
                        retryable=False,
                    )
        else:
            if "tempo" in raw:
                raise FFmpegError(
                    "tempo is only valid on TTS_SEGMENT inputs",
                    "INVALID_INPUT",
                    retryable=False,
                )
    ducking = mix_plan.get("ducking") or {"kind": "NONE"}
    speech_ids = list(ducking.get("speech_input_ids") or [])
    if any(speech_id not in ids for speech_id in speech_ids):
        raise FFmpegError("ducking speech_input_ids must reference inputs", "INVALID_INPUT", retryable=False)
    inputs_by_id = {raw["input_id"]: raw for raw in inputs}
    if any(inputs_by_id[speech_id]["role"] != "TTS_SEGMENT" for speech_id in speech_ids):
        raise FFmpegError("ducking speech_input_ids must reference TTS_SEGMENT inputs", "INVALID_INPUT", retryable=False)
    target_id = ducking.get("target_input_id")
    if ducking.get("kind", "NONE").upper() != "NONE" and target_id not in ids:
        raise FFmpegError("ducking target_input_id must reference an input", "INVALID_INPUT", retryable=False)
    output = mix_plan.get("output") or {}
    if output.get("asset_type") not in (None, "MIXED_AUDIO"):
        raise FFmpegError("output.asset_type must be MIXED_AUDIO", "INVALID_INPUT", retryable=False)


def _apply_gain(segment: AudioSegment, gain_db: float) -> AudioSegment:
    if abs(gain_db) < 0.01:
        return segment
    # pydub apply_gain; extreme mute for -120 dB vocal placeholder
    if gain_db <= -100:
        return AudioSegment.silent(duration=len(segment))
    return segment.apply_gain(gain_db)


def _apply_tempo(path: str, tempo: float, temp_dir: str) -> str:
    """Phase 5 (docs/62 §2): deterministic pitch-preserving atempo (0.5..2.0
    per atempo instance ⊇ the v1 0.8..1.2 range — no chaining needed)."""
    output_path = os.path.join(temp_dir, f"tempo_{uuid.uuid4()}.wav")
    cmd = [
        "ffmpeg",
        "-y",
        "-i", path,
        "-filter:a", f"atempo={tempo:.6f}",
        output_path,
    ]
    _run(cmd)
    return output_path


def _duck_region(
    bed: AudioSegment,
    start_ms: int,
    end_ms: int,
    duck_gain_db: float,
    attack_ms: int,
    release_ms: int,
) -> AudioSegment:
    """Lower bed gain in [start, end] with simple attack/release ramps."""
    start_ms = max(0, start_ms)
    end_ms = min(len(bed), max(start_ms, end_ms))
    if end_ms <= start_ms or len(bed) == 0:
        return bed

    attack_ms = max(0, attack_ms)
    release_ms = max(0, release_ms)

    before = bed[:start_ms]
    region = bed[start_ms:end_ms]
    after = bed[end_ms:]

    ducked = region.apply_gain(duck_gain_db)
    # Soft edges via crossfade-ish slice gains
    if attack_ms > 0 and len(ducked) > attack_ms:
        head = region[:attack_ms].fade(to_gain=duck_gain_db, start=0, end=attack_ms)
        mid = ducked[attack_ms:]
        ducked = head + mid
    if release_ms > 0 and len(ducked) > release_ms:
        body = ducked[:-release_ms]
        tail_src = region[-release_ms:] if len(region) >= release_ms else region
        tail = tail_src.fade(from_gain=duck_gain_db, start=0, end=len(tail_src))
        ducked = body + tail

    return before + ducked + after
