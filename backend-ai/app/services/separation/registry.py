"""Registry for local source-separation engines."""
from __future__ import annotations

from app.schemas.source_separation import SeparationProfileId
from app.services.separation.base import SeparationEngine


class SeparationEngineNotFound(LookupError):
    pass


class UnsupportedSeparationProfile(ValueError):
    pass


class SeparationEngineRegistry:
    def __init__(self, engines: list[SeparationEngine] | None = None) -> None:
        self._engines: dict[str, SeparationEngine] = {}
        for engine in engines or []:
            self.register(engine)

    def register(self, engine: SeparationEngine) -> None:
        if engine.engine_id in self._engines:
            raise ValueError(f"separation engine already registered: {engine.engine_id}")
        self._engines[engine.engine_id] = engine

    def get(self, engine_id: str, profile: SeparationProfileId) -> SeparationEngine:
        try:
            engine = self._engines[engine_id]
        except KeyError as exc:
            raise SeparationEngineNotFound(engine_id) from exc
        if profile not in engine.supported_profiles:
            raise UnsupportedSeparationProfile(
                f"engine {engine_id} does not support profile {profile}"
            )
        return engine

    def ids(self) -> tuple[str, ...]:
        return tuple(self._engines)
