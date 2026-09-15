from __future__ import annotations

from pathlib import Path

import pytest

from app.schemas.source_separation import SeparationProfileId
from app.services.separation.base import EngineResult, SeparationEngine
from app.services.separation.registry import (
    SeparationEngineNotFound,
    SeparationEngineRegistry,
    UnsupportedSeparationProfile,
)


class FakeEngine(SeparationEngine):
    @property
    def engine_id(self) -> str:
        return "fake"

    @property
    def supported_profiles(self) -> frozenset[SeparationProfileId]:
        return frozenset({SeparationProfileId.VOCAL_MUSIC})

    async def separate(self, source_path: Path, output_dir: Path, *, profile, model_id):
        return EngineResult("1", model_id, 0, ())


def test_registry_resolves_engine_by_capability() -> None:
    engine = FakeEngine()
    registry = SeparationEngineRegistry([engine])
    assert registry.get("fake", SeparationProfileId.VOCAL_MUSIC) is engine
    assert registry.ids() == ("fake",)


def test_registry_rejects_unknown_engine() -> None:
    with pytest.raises(SeparationEngineNotFound):
        SeparationEngineRegistry().get("uvr", SeparationProfileId.VOCAL_MUSIC)


def test_registry_rejects_unsupported_profile_without_fallback() -> None:
    with pytest.raises(UnsupportedSeparationProfile):
        SeparationEngineRegistry([FakeEngine()]).get("fake", "VOCAL_ONLY")  # type: ignore[arg-type]


def test_registry_rejects_duplicate_engine_id() -> None:
    with pytest.raises(ValueError, match="already registered"):
        SeparationEngineRegistry([FakeEngine(), FakeEngine()])
