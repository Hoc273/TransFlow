"""Reference adapter for the local Demucs engine.

The adapter owns all Demucs output naming. Downstream code receives logical roles only.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Callable

from app.schemas.source_separation import AudioRole, SeparationProfileId
from app.services.separation.base import EngineResult, EngineStem, SeparationEngine


class DemucsExecutionError(RuntimeError):
    pass


class DemucsGpuUnavailableError(DemucsExecutionError):
    pass


class DemucsAdapter(SeparationEngine):
    def __init__(
        self,
        *,
        executable: str = "python",
        engine_version: str = "demucs",
        gpu_available: Callable[[], bool] | None = None,
    ) -> None:
        self._executable = executable
        self._engine_version = engine_version
        self._gpu_available = gpu_available or _cuda_available

    @property
    def engine_id(self) -> str:
        return "local_demucs"

    @property
    def supported_profiles(self) -> frozenset[SeparationProfileId]:
        return frozenset({SeparationProfileId.VOCAL_MUSIC})

    async def separate(
        self,
        source_path: Path,
        output_dir: Path,
        *,
        profile: SeparationProfileId,
        model_id: str,
    ) -> EngineResult:
        if profile not in self.supported_profiles:
            raise DemucsExecutionError(f"unsupported Demucs profile: {profile}")
        if not self._gpu_available():
            raise DemucsGpuUnavailableError("Demucs GPU is unavailable")
        source_facts = _wav_facts(source_path)
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            self._executable,
            "-m",
            "demucs.separate",
            "--two-stems",
            "vocals",
            "-d",
            "cuda",
            "-n",
            model_id,
            "-o",
            str(output_dir),
            str(source_path),
        ]
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await process.communicate()
        except asyncio.CancelledError:
            await _terminate_process(process)
            raise
        if process.returncode != 0:
            raise DemucsExecutionError(f"Demucs exited with {process.returncode}")

        result_dir = output_dir / model_id / source_path.stem
        vocals_path = result_dir / "vocals.wav"
        music_path = result_dir / "no_vocals.wav"
        required_paths = [(AudioRole.VOCAL, vocals_path), (AudioRole.MUSIC, music_path)]
        missing = [role.value for role, path in required_paths if not path.is_file()]
        if missing:
            raise DemucsExecutionError(f"Demucs did not produce required outputs: {missing}")

        await self._normalize_to_source_format(vocals_path, source_facts)
        await self._normalize_to_source_format(music_path, source_facts)
        stems = [self._stem(AudioRole.VOCAL, vocals_path), self._stem(AudioRole.MUSIC, music_path)]
        return EngineResult(
            engine_version=self._engine_version,
            model_id=model_id,
            input_duration_ms=source_facts["duration_ms"],
            stems=tuple(stems),
        )

    @staticmethod
    async def _normalize_to_source_format(path: Path, source_facts: dict[str, int]) -> None:
        """Keep the logical stems within the stage's extracted-audio byte budget."""
        facts = _wav_facts(path)
        if (facts["sample_rate_hz"], facts["channels"]) == (
            source_facts["sample_rate_hz"],
            source_facts["channels"],
        ):
            return

        normalized_path = path.with_name(f"{path.stem}.normalized.wav")
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",
            "-i",
            str(path),
            "-ar",
            str(source_facts["sample_rate_hz"]),
            "-ac",
            str(source_facts["channels"]),
            "-c:a",
            "pcm_s16le",
            str(normalized_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await process.communicate()
        except asyncio.CancelledError:
            await _terminate_process(process)
            raise
        if process.returncode != 0 or not normalized_path.is_file():
            raise DemucsExecutionError("Unable to normalize Demucs output")
        normalized_path.replace(path)

    @staticmethod
    def _stem(role: AudioRole, path: Path) -> EngineStem:
        facts = _wav_facts(path)
        return EngineStem(
            role=role,
            path=path,
            duration_ms=facts["duration_ms"],
            mime_type="audio/wav",
            codec="pcm_s16le",
            channels=facts["channels"],
            sample_rate_hz=facts["sample_rate_hz"],
        )


async def _terminate_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=10)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()


def _wav_facts(path: Path) -> dict[str, int]:
    """Read WAV facts without introducing a runtime audio dependency."""
    import wave

    try:
        with wave.open(str(path), "rb") as wav:
            frames = wav.getnframes()
            sample_rate = wav.getframerate()
            duration_ms = round(frames * 1000 / sample_rate) if sample_rate else 0
            return {
                "duration_ms": duration_ms,
                "channels": wav.getnchannels(),
                "sample_rate_hz": sample_rate,
            }
    except (OSError, wave.Error) as exc:
        raise DemucsExecutionError("Demucs produced an unreadable WAV artifact") from exc


def _cuda_available() -> bool:
    try:
        import torch
    except ImportError:
        return False
    return bool(torch.cuda.is_available())
