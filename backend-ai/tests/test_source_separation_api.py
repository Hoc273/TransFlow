from __future__ import annotations

from contextlib import contextmanager

from fastapi.testclient import TestClient

from app.api import source_separation
from app.main import app
from app.services.separation.demucs_adapter import DemucsGpuUnavailableError
from app.services.source_separation_gateway import (
    SeparationAdmissionError,
    SeparationCapacityError,
    SeparationExecutionTimeoutError,
)


class FailingGateway:
    def __init__(self, error: Exception) -> None:
        self._error = error

    async def separate(self, request):
        raise self._error


@contextmanager
def gateway(error: Exception):
    app.dependency_overrides[source_separation.get_gateway] = lambda: FailingGateway(error)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def request_body() -> dict[str, str]:
    return {
        "runId": "api-contract-run",
        "sourceAudioRef": "transflow-media/extracted/api-contract.wav",
        "profile": "VOCAL_MUSIC",
    }


def test_capacity_exhaustion_is_retryable_http_429() -> None:
    with gateway(SeparationCapacityError("source separation capacity is exhausted")) as client:
        response = client.post("/media/source-separate", json=request_body())

    assert response.status_code == 429
    assert response.json() == {"detail": {
        "code": "GPU_UNAVAILABLE",
        "message": "source separation capacity is exhausted",
        "retryable": True,
    }}


def test_invalid_input_is_non_retryable_http_400() -> None:
    with gateway(SeparationAdmissionError("source audio exceeds the configured size budget")) as client:
        response = client.post("/media/source-separate", json=request_body())

    assert response.status_code == 400
    assert response.json() == {"detail": {
        "code": "INVALID_SEPARATION_INPUT",
        "message": "source audio exceeds the configured size budget",
        "retryable": False,
    }}


def test_gpu_unavailable_is_retryable_http_503() -> None:
    with gateway(DemucsGpuUnavailableError("Demucs GPU is unavailable")) as client:
        response = client.post("/media/source-separate", json=request_body())

    assert response.status_code == 503
    assert response.json() == {"detail": {
        "code": "GPU_UNAVAILABLE",
        "message": "Demucs GPU is unavailable",
        "retryable": True,
    }}


def test_execution_timeout_is_retryable_http_504() -> None:
    with gateway(SeparationExecutionTimeoutError("source separation attempt timed out")) as client:
        response = client.post("/media/source-separate", json=request_body())

    assert response.status_code == 504
    assert response.json() == {"detail": {
        "code": "SEPARATION_TIMEOUT",
        "message": "source separation attempt timed out",
        "retryable": True,
    }}
