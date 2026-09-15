"""Standard error DTO for AI-provider failures.

Mirrors the Java ProviderErrorResponse so Spring Boot can map FastAPI
error bodies directly into the same structured shape.
"""
from __future__ import annotations

from pydantic import BaseModel


class ProviderErrorDetail(BaseModel):
    """Structured provider error body returned by all AI endpoints."""

    errorCode: str
    title: str
    message: str
    details: dict[str, str] | None = None
    provider: str | None = None
    protocol: str | None = None
    capability: str | None = None
    retryable: bool
    recommendedAction: str
    documentation: str
