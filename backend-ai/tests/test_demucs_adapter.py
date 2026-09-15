from __future__ import annotations

import asyncio
import wave
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.schemas.source_separation import AudioRole, SeparationProfileId
from app.services.separation.demucs_adapter import (
    DemucsAdapter,
    DemucsExecutionError,
    DemucsGpuUnavailableError,
    _wav_facts,
)


class FakeProcess:
    def __init__(self, returncode: int = 0, stderr: bytes = b"") -> None:
        self.returncode = returncode
        self.communicate = AsyncMock(return_value=(b"", stderr))
        self.wait = AsyncMock(return_value=returncode)
        self.terminate = Mock()
        self.kill = Mock()


def write_wav(path: Path) -> None:
    write_wav_with_format(path, sample_rate=8000, channels=2)


def write_wav_with_format(path: Path, *, sample_rate: int, channels: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00\x00" * channels * sample_rate)


@pytest.mark.asyncio
async def test_demucs_adapter_maps_provider_outputs_to_logical_roles(tmp_path: Path) -> None:
    source = tmp_path / "audio.wav"
    write_wav(source)
    output = tmp_path / "out"
    result_dir = output / "htdemucs" / "audio"
    write_wav(result_dir / "vocals.wav")
    write_wav(result_dir / "no_vocals.wav")

    with patch("asyncio.create_subprocess_exec", new=AsyncMock(return_value=FakeProcess())):
        result = await DemucsAdapter(gpu_available=lambda: True).separate(
            source,
            output,
            profile=SeparationProfileId.VOCAL_MUSIC,
            model_id="htdemucs",
        )

    assert [stem.role for stem in result.stems] == [AudioRole.VOCAL, AudioRole.MUSIC]
    assert result.input_duration_ms == 1000
    assert result.stems[0].sample_rate_hz == 8000


@pytest.mark.asyncio
async def test_demucs_adapter_fails_when_required_output_is_missing(tmp_path: Path) -> None:
    source = tmp_path / "audio.wav"
    write_wav(source)
    with patch("asyncio.create_subprocess_exec", new=AsyncMock(return_value=FakeProcess())):
        with pytest.raises(DemucsExecutionError, match="required outputs"):
            await DemucsAdapter(gpu_available=lambda: True).separate(
                source,
                tmp_path / "out",
                profile=SeparationProfileId.VOCAL_MUSIC,
                model_id="htdemucs",
            )


@pytest.mark.asyncio
async def test_demucs_adapter_terminates_subprocess_when_cancelled(tmp_path: Path) -> None:
    source = tmp_path / "audio.wav"
    write_wav(source)
    process = FakeProcess(returncode=None)  # type: ignore[arg-type]
    process.communicate = AsyncMock(side_effect=asyncio.CancelledError)

    with patch("asyncio.create_subprocess_exec", new=AsyncMock(return_value=process)):
        with pytest.raises(asyncio.CancelledError):
            await DemucsAdapter(gpu_available=lambda: True).separate(
                source,
                tmp_path / "out",
                profile=SeparationProfileId.VOCAL_MUSIC,
                model_id="htdemucs",
            )

    process.terminate.assert_called_once()
    process.wait.assert_awaited_once()
    process.kill.assert_not_called()


@pytest.mark.asyncio
async def test_demucs_adapter_requires_gpu_before_invoking_demucs(tmp_path: Path) -> None:
    with pytest.raises(DemucsGpuUnavailableError, match="GPU is unavailable"):
        await DemucsAdapter(gpu_available=lambda: False).separate(
            tmp_path / "audio.wav",
            tmp_path / "out",
            profile=SeparationProfileId.VOCAL_MUSIC,
            model_id="htdemucs",
        )


@pytest.mark.asyncio
async def test_demucs_adapter_normalizes_stems_to_the_extracted_audio_format(tmp_path: Path) -> None:
    source = tmp_path / "audio.wav"
    write_wav_with_format(source, sample_rate=8000, channels=1)
    stem = tmp_path / "vocals.wav"
    write_wav_with_format(stem, sample_rate=44100, channels=2)
    normalized = stem.with_name("vocals.normalized.wav")

    async def normalize_process(*command, **kwargs):
        assert command[0] == "ffmpeg"
        assert "-ar" in command and command[command.index("-ar") + 1] == "8000"
        assert "-ac" in command and command[command.index("-ac") + 1] == "1"
        write_wav_with_format(normalized, sample_rate=8000, channels=1)
        return FakeProcess()

    with patch("asyncio.create_subprocess_exec", new=normalize_process):
        await DemucsAdapter._normalize_to_source_format(
            stem,
            {"duration_ms": 1000, "sample_rate_hz": 8000, "channels": 1},
        )

    assert _wav_facts(stem) == {"duration_ms": 1000, "sample_rate_hz": 8000, "channels": 1}
