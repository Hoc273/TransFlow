"""FastAPI AI microservice entrypoint (0.6).

Run (dev):  uvicorn app.main:app --reload --port 8000  (from backend-ai/)
Stateless w.r.t. business data — see docs/01-architecture.md §2.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.media import media_router
from app.api.routes import router
from app.api.source_separation import source_separation_router
from app.api.validate import validate_router
from app.core.config import settings
from app.core.internal_auth import InternalTokenMiddleware
from app.core.logging_config import setup_logging
from app.services.provider_errors import ProviderException

setup_logging(level=settings.log_level)

app = FastAPI(
    title="TransFlow AI Microservice",
    version="0.2.0",
    description="AI Gateway for TransFlow Media Studio: STT, TTS, Translate, QA, Summarize, VLM, Source Separation.",
)

app.add_middleware(InternalTokenMiddleware, token_getter=lambda: settings.internal_service_token)

app.include_router(router)
app.include_router(media_router)
app.include_router(source_separation_router)
app.include_router(validate_router)


@app.exception_handler(ProviderException)
async def provider_exception_handler(request: Request, exc: ProviderException) -> JSONResponse:
    """Return a structured ProviderErrorDetail body for all provider failures."""
    return JSONResponse(
        status_code=exc.http_status,
        content=exc.to_error_detail(),
    )


@app.get("/health")
async def health() -> dict[str, object]:
    # CT10.2: separation/gpu is readiness evidence only (not product capability).
    from app.services.separation.demucs_adapter import _cuda_available

    return {
        "status": "ok",
        "service": "backend-ai",
        "mock_mode": settings.mock_mode,
        "separation": {
            "engine": settings.separation_engine_id,
            "gpu_available": _cuda_available(),
        },
    }


@app.on_event("startup")
async def _startup_checks() -> None:
    import logging

    log = logging.getLogger("transflow.ai")
    if settings.mock_mode:
        log.warning("mock_mode=ON — provider calls are stubbed, no tokens will be spent.")

    # A2.1: Generated Asset Cache maintenance (sweeper LRU + hit_count flush).
    # Loops are best-effort and isolated — a failing loop never affects runtime.
    from app.services.generated_asset_cache import start_background_maintenance

    await start_background_maintenance()


@app.on_event("shutdown")
async def _shutdown_maintenance() -> None:
    from app.services.generated_asset_cache import stop_background_maintenance

    await stop_background_maintenance()
