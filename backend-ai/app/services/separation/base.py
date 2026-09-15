"""Engine-neutral source-separation port."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

from app.schemas.source_separation import AudioRole, SeparationProfileId


@dataclass(frozen=True)
class EngineStem:
    role: AudioRole
    path: Path
    duration_ms: int
    mime_type: str
    codec: str
    channels: int
    sample_rate_hz: int


@dataclass(frozen=True)
class EngineResult:
    engine_version: str
    model_id: str
    input_duration_ms: int
    stems: tuple[EngineStem, ...]


class SeparationEngine(ABC):
    @property
    @abstractmethod
    def engine_id(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def supported_profiles(self) -> frozenset[SeparationProfileId]:
        raise NotImplementedError

    @abstractmethod
    async def separate(
        self,
        source_path: Path,
        output_dir: Path,
        *,
        profile: SeparationProfileId,
        model_id: str,
    ) -> EngineResult:
        raise NotImplementedError
