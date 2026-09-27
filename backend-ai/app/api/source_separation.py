"""Internal source-separation endpoint; no public client contract."""
from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.source_separation import SeparationManifest, SourceSeparationRequest
from app.services.separation.demucs_adapter import DemucsAdapter
from app.services.separation.registry import SeparationEngineRegistry
from app.services.separation.storage import MinioSeparationStorage
from app.services.separation.demucs_adapter import DemucsGpuUnavailableError
from app.services.source_separation_gateway import (
    SeparationAdmissionError,
    SeparationCapacityError,
    SeparationExecutionTimeoutError,
    SourceSeparationGateway,
)

source_separation_router = APIRouter(prefix="/media")


@lru_cache
def _gateway() -> SourceSeparationGateway:
    from app.core.config import settings

    mock_engine = settings.separation_engine_id.strip().lower() == "mock"
    registry = SeparationEngineRegistry(
        [
            DemucsAdapter(
                executable=settings.separation_demucs_executable,
                allow_cpu_fallback=settings.separation_cpu_fallback or settings.mock_mode or mock_engine,
            )
        ]
    )
    storage = MinioSeparationStorage(
        endpoint=settings.media_storage_endpoint,
        access_key=settings.media_storage_access_key,
        secret_key=settings.media_storage_secret_key,
        bucket=settings.media_storage_bucket,
        secure=settings.media_storage_secure,
    )
    return SourceSeparationGateway(
        registry,
        storage,
        engine_id="local_demucs" if mock_engine else settings.separation_engine_id,
        max_input_bytes=settings.separation_max_input_bytes,
        max_input_duration_ms=settings.separation_max_input_duration_ms,
        max_output_size_multiplier=settings.separation_max_output_size_multiplier,
        execution_timeout_seconds=settings.separation_execution_timeout_seconds,
        max_concurrent_jobs=settings.separation_max_concurrent_jobs,
    )


def get_gateway() -> SourceSeparationGateway:
    return _gateway()


@source_separation_router.post(
    "/source-separate",
    response_model=SeparationManifest,
)
async def source_separate(
    req: SourceSeparationRequest,
    gateway: SourceSeparationGateway = Depends(get_gateway),
) -> SeparationManifest:
    try:
        return await gateway.separate(req)
    except SeparationCapacityError as exc:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "GPU_UNAVAILABLE",
                "message": str(exc),
                "retryable": True,
            },
        ) from exc
    except SeparationAdmissionError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_SEPARATION_INPUT",
                "message": str(exc),
                "retryable": False,
            },
        ) from exc
    except DemucsGpuUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "GPU_UNAVAILABLE",
                "message": str(exc),
                "retryable": True,
            },
        ) from exc
    except SeparationExecutionTimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail={
                "code": "SEPARATION_TIMEOUT",
                "message": str(exc),
                "retryable": True,
            },
        ) from exc
