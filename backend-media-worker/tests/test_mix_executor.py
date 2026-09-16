"""CT8 MixPlan worker contract tests."""

from __future__ import annotations

import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest
from pydub import AudioSegment

from app.services.ffmpeg import FFmpegError
from app.services.mix_executor import execute_mix_plan, _validate_plan


def _write_silent_wav(path: str, duration_ms: int = 1000) -> None:
    AudioSegment.silent(duration=duration_ms).export(path, format="wav")


def test_validate_plan_rejects_bad_version():
    with pytest.raises(FFmpegError) as exc:
        _validate_plan({"plan_version": 99, "inputs": [{"input_id": "a", "role": "ORIGINAL_MIX", "audio_ref": "b/k"}]})
    assert exc.value.code == "INVALID_INPUT"


def test_validate_plan_rejects_filesystem_path():
    with pytest.raises(FFmpegError) as exc:
        _validate_plan({
            "plan_version": 1,
            "inputs": [{"input_id": "bed", "role": "ORIGINAL_MIX", "audio_ref": "/tmp/x.wav"}],
        })
    assert "opaque" in str(exc.value).lower() or "bucket" in str(exc.value).lower()


def test_validate_plan_rejects_path_like_input_id():
    with pytest.raises(FFmpegError) as exc:
        _validate_plan({
            "plan_version": 1,
            "inputs": [{"input_id": "../bed", "role": "ORIGINAL_MIX", "audio_ref": "media/a.wav"}],
        })
    assert exc.value.code == "INVALID_INPUT"


def test_validate_plan_rejects_ducking_non_tts_speech_input():
    with pytest.raises(FFmpegError) as exc:
        _validate_plan({
            "plan_version": 1,
            "inputs": [{"input_id": "bed", "role": "ORIGINAL_MIX", "audio_ref": "media/a.wav"}],
            "ducking": {"kind": "WHOLE_MIX", "target_input_id": "bed", "speech_input_ids": ["bed"]},
        })
    assert exc.value.code == "INVALID_INPUT"


def test_validate_plan_rejects_tempo_on_non_tts_input():
    with pytest.raises(FFmpegError) as exc:
        _validate_plan({
            "plan_version": 1,
            "inputs": [
                {
                    "input_id": "bed",
                    "role": "ORIGINAL_MIX",
                    "audio_ref": "media/a.wav",
                    "tempo": 1.1,
                }
            ],
        })
    assert exc.value.code == "INVALID_INPUT"
    assert "only valid on TTS_SEGMENT" in str(exc.value)


def test_validate_plan_rejects_tempo_out_of_range():
    for bad in (0.7, 1.3, "fast"):
        with pytest.raises(FFmpegError) as exc:
            _validate_plan({
                "plan_version": 1,
                "inputs": [
                    {
                        "input_id": "bed",
                        "role": "ORIGINAL_MIX",
                        "audio_ref": "media/a.wav",
                    },
                    {
                        "input_id": "tts-0",
                        "role": "TTS_SEGMENT",
                        "audio_ref": "media/t.wav",
                        "segment_id": "seg-1",
                        "start_ms": 0,
                        "end_ms": 100,
                        "tempo": bad,
                    },
                ],
            })
        assert exc.value.code == "INVALID_INPUT"


def test_validate_plan_accepts_tempo_bounds():
    plan = {
        "plan_version": 1,
        "inputs": [
            {"input_id": "bed", "role": "ORIGINAL_MIX", "audio_ref": "media/a.wav"},
            {
                "input_id": "tts-0",
                "role": "TTS_SEGMENT",
                "audio_ref": "media/t.wav",
                "segment_id": "seg-1",
                "start_ms": 0,
                "end_ms": 100,
                "tempo": 0.8,
            },
            {
                "input_id": "tts-1",
                "role": "TTS_SEGMENT",
                "audio_ref": "media/t2.wav",
                "segment_id": "seg-2",
                "start_ms": 100,
                "end_ms": 200,
                "tempo": 1.2,
            },
        ],
    }
    _validate_plan(plan)  # must not raise


def _plan_with_tempo(tempo=None):
    plan = {
        "plan_version": 1,
        "plan_id": "p1",
        "media_job_id": "j1",
        "assembly_path": "FAST",
        "inputs": [
            {
                "input_id": "bed",
                "role": "ORIGINAL_MIX",
                "audio_ref": "media/bed.wav",
                "gain_db": 0,
                "offset_ms": 0,
                "fade_in_ms": 0,
                "fade_out_ms": 0,
            },
            {
                "input_id": "tts-0",
                "role": "TTS_SEGMENT",
                "audio_ref": "media/tts.wav",
                "gain_db": 0,
                "offset_ms": 0,
                "fade_in_ms": 0,
                "fade_out_ms": 0,
                "segment_id": "seg-1",
                "start_ms": 500,
                "end_ms": 1000,
            },
        ],
        "ducking": {
            "kind": "WHOLE_MIX",
            "target_input_id": "bed",
            "duck_gain_db": -12,
            "attack_ms": 50,
            "release_ms": 50,
            "speech_input_ids": ["tts-0"],
            "limitations": ["SPEECH_MAY_BLEED"],
        },
        "output": {
            "asset_type": "MIXED_AUDIO",
            "format": "wav",
            "sample_rate_hz": 48000,
            "channels": 2,
        },
        "notes": [],
    }
    if tempo is not None:
        plan["inputs"][1]["tempo"] = tempo
    return plan


def test_execute_with_tempo_applies_atempo_before_fit(tmp_path):
    bed_path = tmp_path / "bed.wav"
    tts_path = tmp_path / "tts.wav"
    _write_silent_wav(str(bed_path), 3000)
    _write_silent_wav(str(tts_path), 500)

    def fake_download(ref, local):
        src = bed_path if "bed" in ref else tts_path
        AudioSegment.from_file(src).export(local, format="wav")

    storage = MagicMock()
    storage.download.side_effect = fake_download

    work = tmp_path / "work"
    work.mkdir()
    with patch("app.services.mix_executor.get_storage", return_value=storage), patch(
        "app.services.mix_executor._apply_tempo",
        wraps=lambda path, tempo, temp_dir: path,
    ) as apply_tempo:
        out, duration_ms, warnings = execute_mix_plan(_plan_with_tempo(1.1), str(work))

    assert os.path.isfile(out)
    assert duration_ms > 0
    # tempo applied exactly once, on the TTS input, before fit
    assert apply_tempo.call_count == 1
    assert apply_tempo.call_args.args[1] == 1.1


def test_execute_without_tempo_skips_atempo(tmp_path):
    bed_path = tmp_path / "bed.wav"
    tts_path = tmp_path / "tts.wav"
    _write_silent_wav(str(bed_path), 3000)
    _write_silent_wav(str(tts_path), 500)

    def fake_download(ref, local):
        src = bed_path if "bed" in ref else tts_path
        AudioSegment.from_file(src).export(local, format="wav")

    storage = MagicMock()
    storage.download.side_effect = fake_download

    work = tmp_path / "work"
    work.mkdir()
    with patch("app.services.mix_executor.get_storage", return_value=storage), patch(
        "app.services.mix_executor._apply_tempo",
        wraps=lambda path, tempo, temp_dir: path,
    ) as apply_tempo:
        out, duration_ms, warnings = execute_mix_plan(_plan_with_tempo(None), str(work))

    assert os.path.isfile(out)
    assert apply_tempo.call_count == 0


def test_apply_tempo_uses_pitch_preserving_atempo(tmp_path):
    from app.services.mix_executor import _apply_tempo
    src = tmp_path / "src.wav"
    out = tmp_path / "tempo_out.wav"
    _write_silent_wav(str(src), 1000)
    with patch("app.services.mix_executor._run") as run:
        _apply_tempo(str(src), 1.1, str(tmp_path))

    cmd = run.call_args.args[0]
    assert "-filter:a" in cmd
    assert "atempo=1.100000" in cmd


def test_execute_fast_whole_mix_duck(tmp_path):
    bed_path = tmp_path / "bed.wav"
    tts_path = tmp_path / "tts.wav"
    _write_silent_wav(str(bed_path), 3000)
    _write_silent_wav(str(tts_path), 500)

    plan = {
        "plan_version": 1,
        "plan_id": "p1",
        "media_job_id": "j1",
        "assembly_path": "FAST",
        "inputs": [
            {
                "input_id": "bed",
                "role": "ORIGINAL_MIX",
                "audio_ref": "media/bed.wav",
                "gain_db": 0,
                "offset_ms": 0,
                "fade_in_ms": 0,
                "fade_out_ms": 0,
            },
            {
                "input_id": "tts-0",
                "role": "TTS_SEGMENT",
                "audio_ref": "media/tts.wav",
                "gain_db": 0,
                "offset_ms": 0,
                "fade_in_ms": 0,
                "fade_out_ms": 0,
                "segment_id": "seg-1",
                "start_ms": 500,
                "end_ms": 1000,
            },
        ],
        "ducking": {
            "kind": "WHOLE_MIX",
            "target_input_id": "bed",
            "duck_gain_db": -12,
            "attack_ms": 50,
            "release_ms": 50,
            "speech_input_ids": ["tts-0"],
            "limitations": ["SPEECH_MAY_BLEED"],
        },
        "output": {
            "asset_type": "MIXED_AUDIO",
            "format": "wav",
            "sample_rate_hz": 48000,
            "channels": 2,
        },
        "notes": [],
    }

    def fake_download(ref, local):
        src = bed_path if "bed" in ref else tts_path
        AudioSegment.from_file(src).export(local, format="wav")

    storage = MagicMock()
    storage.download.side_effect = fake_download

    work = tmp_path / "work"
    work.mkdir()
    with patch("app.services.mix_executor.get_storage", return_value=storage):
        out, duration_ms, warnings = execute_mix_plan(plan, str(work))

    assert os.path.isfile(out)
    assert duration_ms > 0
    assert isinstance(warnings, list)
