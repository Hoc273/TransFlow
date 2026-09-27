"""Dub voice placement: level every clip, never drop speech while it can fit."""
from __future__ import annotations

from pydub import AudioSegment
from pydub.generators import Sine

from app.services.dub_timeline import (
    MAX_LAG_MS,
    VOICE_TARGET_DBFS,
    VoiceClip,
    prepare_voice,
    schedule,
)


def _tone(ms: int, volume: float = -20.0) -> AudioSegment:
    return Sine(300).to_audio_segment(duration=ms, volume=volume)


def test_prepare_voice_trims_provider_silence() -> None:
    clip = AudioSegment.silent(duration=400) + _tone(1_000) + AudioSegment.silent(duration=600)

    prepared = prepare_voice(clip)

    assert 1_000 <= len(prepared) <= 1_100


def test_prepare_voice_levels_quiet_and_loud_clips_alike() -> None:
    quiet = prepare_voice(_tone(1_000, volume=-33))
    loud = prepare_voice(_tone(1_000, volume=-6))

    assert abs(quiet.dBFS - loud.dBFS) < 1.0
    assert abs(quiet.dBFS - VOICE_TARGET_DBFS) < 1.5
    assert loud.max_dBFS <= -0.9


def test_prepare_voice_keeps_silent_clip() -> None:
    silent = AudioSegment.silent(duration=500)

    assert len(prepare_voice(silent)) == 500


def test_line_runs_into_following_pause_without_speed_change(tmp_path) -> None:
    clips = [VoiceClip("a", 0, 1_000, _tone(1_800)), VoiceClip("b", 3_000, 4_000, _tone(800))]

    placed, warnings = schedule(clips, 10_000, str(tmp_path))

    assert [p.position_ms for p in placed] == [0, 3_000]
    assert len(placed[0].audio) == 1_800
    assert warnings == []


def test_line_is_sped_up_only_to_fit_before_the_next_subtitle(tmp_path) -> None:
    clips = [VoiceClip("a", 0, 1_000, _tone(2_400)), VoiceClip("b", 2_000, 3_000, _tone(500))]

    placed, _ = schedule(clips, 10_000, str(tmp_path))

    assert len(placed[0].audio) < 2_400
    assert placed[0].end_ms <= placed[1].position_ms


def test_late_line_shifts_the_next_one_instead_of_overlapping(tmp_path) -> None:
    # 3 s of speech for a 1 s gap: even at max tempo it runs past the next start.
    clips = [VoiceClip("a", 0, 900, _tone(3_000)), VoiceClip("b", 1_000, 2_000, _tone(500))]

    placed, warnings = schedule(clips, 10_000, str(tmp_path))

    assert placed[1].position_ms >= placed[0].end_ms
    assert any(w["code"] in {"AUDIO_DELAYED", "AUDIO_TRUNCATED"} for w in warnings)


def test_only_extreme_overrun_is_faded_out(tmp_path) -> None:
    clips = [VoiceClip("a", 0, 500, _tone(6_000)), VoiceClip("b", 1_000, 1_500, _tone(300))]

    placed, warnings = schedule(clips, 10_000, str(tmp_path))

    assert placed[0].end_ms <= 1_000 + MAX_LAG_MS
    assert warnings[0]["code"] == "AUDIO_TRUNCATED"
    assert warnings[0]["segment_id"] == "a"
