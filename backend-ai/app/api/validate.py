"""4-phase provider validation endpoints (docs/07 §L, Q-PV-*)."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.logging_config import get_frontend_logger, get_internal_logger
from app.schemas.validate import (
    AuthProbeRequest,
    AuthProbeResponse,
    ConnectionProbeRequest,
    ConnectionProbeResponse,
    FeaturesProbeRequest,
    FeaturesProbeResponse,
    PhaseResult,
    ProviderTestResult,
    SttProbeRequest,
    SttProbeResponse,
    TtsProbeRequest,
    TtsProbeResponse,
)
from app.services import validate_gateway
from app.services.provider_errors import ProviderException

_int_log = get_internal_logger("validate_api")
_fe_log = get_frontend_logger("validate_api")

validate_router = APIRouter(prefix="/ai/validate")


@validate_router.post("/connection", response_model=ConnectionProbeResponse)
async def connection_probe(req: ConnectionProbeRequest) -> ConnectionProbeResponse:
    """Phase 1 — server reachability (no API key)."""
    return await validate_gateway.probe_connection(req)


@validate_router.post("/auth", response_model=AuthProbeResponse)
async def auth_probe(req: AuthProbeRequest) -> AuthProbeResponse:
    """Phase 2 — API key validity (protocol-aware)."""
    return await validate_gateway.probe_auth(req)


@validate_router.post("/stt-probe", response_model=SttProbeResponse)
async def stt_capability_probe(req: SttProbeRequest) -> SttProbeResponse:
    """Phase 3 STT — tiny transcription probe."""
    return await validate_gateway.probe_stt_capability(req)


@validate_router.post("/tts-probe", response_model=TtsProbeResponse)
async def tts_capability_probe(req: TtsProbeRequest) -> TtsProbeResponse:
    """Phase 3 TTS — tiny synthesis probe."""
    return await validate_gateway.probe_tts_capability(req)


@validate_router.post("/features", response_model=FeaturesProbeResponse)
async def features_probe(req: FeaturesProbeRequest) -> FeaturesProbeResponse:
    """Phase 4 — optional features (non-blocking)."""
    return await validate_gateway.probe_optional_features(req)
