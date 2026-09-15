"""Shared HTTP helpers for protocol adapters."""
from __future__ import annotations

import httpx

from app.schemas.contract import ProviderPayload
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderException,
    RETRYABLE_HTTP_STATUS,
    map_http_status_to_code,
)


def join_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def normalize_base_url(raw: str) -> str:
    url = (raw or "").strip().rstrip("/")
    scheme_end = url.find("://")
    if scheme_end != -1:
        scheme, rest = url[: scheme_end + 3], url[scheme_end + 3 :]
        rest = "/".join(segment for segment in rest.split("/") if segment)
        url = scheme + rest
    return url


def raise_for_http_status(
    response: httpx.Response,
    provider: ProviderPayload,
    *,
    operation: str,
    capability: str | None = None,
    log=None,
) -> None:
    """Map HTTP status codes to structured ``ProviderException`` subclasses."""
    if response.status_code in RETRYABLE_HTTP_STATUS:
        code = (
            ProviderErrorCode.PROVIDER_RATE_LIMITED
            if response.status_code == 429
            else ProviderErrorCode.PROVIDER_INTERNAL_ERROR
        )
        raise ProviderException(
            code,
            f"Provider transient error during {operation} ({response.status_code})",
            provider=provider.base_url,
            protocol=provider.protocol,
            capability=capability,
        )

    if response.status_code >= 400:
        code = map_http_status_to_code(response.status_code, provider_label=operation)
        # Truncated vendor body for diagnosis (never log Authorization / api keys).
        vendor_detail = ""
        try:
            raw = (response.text or "").strip()
            if raw:
                vendor_detail = raw[:400]
        except Exception:
            vendor_detail = ""
        if log is not None:
            log.warning(
                "Provider %s %s returned %s",
                provider.base_url,
                operation,
                response.status_code,
                extra={
                    "errorCode": code,
                    "vendorStatus": response.status_code,
                    "provider": provider.base_url,
                    "protocol": provider.protocol,
                    "vendorBody": vendor_detail or None,
                },
            )
        message = f"Provider rejected {operation} ({response.status_code})"
        if vendor_detail:
            message = f"{message}: {vendor_detail}"
        raise ProviderException(
            code,
            message,
            provider=provider.base_url,
            protocol=provider.protocol,
            capability=capability,
        )


def openai_models_path(base_url: str) -> str:
    """Avoid duplicating ``/v1`` when the base URL already ends with it."""
    normalised = normalize_base_url(base_url)
    if normalised.endswith("/v1"):
        return "/models"
    return "/v1/models"
