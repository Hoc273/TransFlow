import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import audio_mix, capabilities, extract_audio, frames, probe, render
from app.core.config import settings
from app.core.internal_auth import InternalTokenMiddleware
from app.services import cancel_registry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Media Processing Worker starting revision=%s", settings.revision)
    yield
    # H4 — graceful shutdown: mark all in-flight renders cancelled so they stop
    # between ffmpeg steps and send a final callback rather than leaving jobs stuck.
    active = cancel_registry.active_ids()
    for correlation_id in active:
        cancel_registry.request_cancel(correlation_id)
        logger.warning("Shutdown: cancel requested for in-flight render %s", correlation_id)
    logger.info("Media Processing Worker stopped")


app = FastAPI(title="TransFlow Media Processing Worker", lifespan=lifespan)
app.add_middleware(InternalTokenMiddleware, token_getter=lambda: settings.internal_service_token)

app.include_router(extract_audio.router, prefix="/internal/media")
app.include_router(render.router, prefix="/internal/media")
app.include_router(audio_mix.router, prefix="/internal/media")
app.include_router(probe.router, prefix="/internal/media")
app.include_router(capabilities.router, prefix="/internal/media")
app.include_router(frames.router, prefix="/internal/media")


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "active_renders": len(cancel_registry.active_ids()),
        "revision": settings.revision,
    }
