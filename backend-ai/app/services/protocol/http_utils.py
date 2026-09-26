"""Shared HTTP helpers for protocol adapters."""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from app.schemas.contract import ProviderPayload
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderException,
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
    """Classify vendor codes before status and keep vendor text out of client errors."""
    if response.status_code < 400:
        return

    raw_body = _response_text(response)
    vendor_code, vendor_message = _vendor_error(raw_body)
    code = _classify_provider_error(response.status_code, vendor_code, vendor_message)
    details = {"vendorStatus": str(response.status_code)}
    if vendor_code:
        details["vendorCode"] = vendor_code[:160]
    retry_after = retry_after_seconds(response.headers.get("retry-after"))
    if retry_after is not None:
        # Spring Boot defers the stage by this much instead of retrying immediately.
        details["retryAfterSeconds"] = str(retry_after)
    if log is not None:
        log.warning(
            "Provider operation failed status=%s protocol=%s capability=%s model=%s",
            response.status_code,
            provider.protocol,
            capability,
            provider.model,
            extra={
                "errorCode": code,
                "vendorStatus": response.status_code,
                "vendorCode": vendor_code,
                "protocol": provider.protocol,
                "capability": capability,
                "model": provider.model,
                "vendorBody": _redacted_vendor_body(raw_body) or None,
            },
        )
    raise ProviderException(
        code,
        _safe_message(code),
        provider=provider.base_url,
        protocol=provider.protocol,
        capability=capability,
        model=provider.model,
        details=details,
    )


def retry_after_seconds(value: str | None) -> int | None:
    """Parse a ``Retry-After`` header (delta-seconds or HTTP-date) into whole seconds."""
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return int(value)
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0, math.ceil((when - datetime.now(timezone.utc)).total_seconds()))


def _response_text(response: httpx.Response) -> str:
    try:
        return response.text or ""
    except Exception:
        return ""


def _vendor_error(raw_body: str) -> tuple[str | None, str]:
    try:
        data = json.loads(raw_body)
    except (TypeError, ValueError):
        return None, raw_body[:1000]
    error = data.get("error") if isinstance(data, dict) else None
    code = None
    message = ""
    if isinstance(error, dict):
        code = error.get("code") or error.get("type")
        message = error.get("message") or ""
    elif isinstance(error, str):
        message = error
    if isinstance(data, dict):
        code = code or data.get("code") or data.get("error_code") or data.get("errorCode")
        message = message or data.get("message") or data.get("error_message") or ""
    return (str(code) if code is not None else None, str(message))


def _classify_provider_error(status: int, vendor_code: str | None, vendor_message: str) -> ProviderErrorCode:
    if status >= 500:
        # A 5xx is the gateway's own failure. Routers (FreeLLMAPI, OpenRouter) aggregate
        # upstream errors into the message, e.g. "... Ollama Cloud API error 401: Unauthorized"
        # inside a 502; keyword-matching that would turn a transient failure non-retryable.
        return map_http_status_to_code(status)
    signal =f"{vendor_code or ''} {vendor_message}".lower().replace("_", " ").replace(".", " ")
    if any(token in signal for token in (
        "allocationquota", "insufficient quota", "insufficient_quota", "quota exceeded",
        "quota exhausted", "prepaid exhausted", "balance insufficient", "free tier only",
        "billing quota", "allocation quota",
    )):
        return ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED
    if any(token in signal for token in (
        "model not found", "model_not_found", "modelnotfound", "invalid model", "invalidmodel",
        "model does not exist",
    )):
        return ProviderErrorCode.PROVIDER_MODEL_NOT_FOUND
    if any(token in signal for token in ("unsupported model", "unsupported_model", "model not supported")):
        return ProviderErrorCode.PROVIDER_UNSUPPORTED_MODEL
    if any(token in signal for token in ("invalid api key", "invalidapikey", "unauthorized", "authentication failed")):
        return ProviderErrorCode.PROVIDER_AUTH_FAILED
    if any(token in signal for token in ("throttling", "rate limit", "rate_limit", "too many requests")):
        return ProviderErrorCode.PROVIDER_RATE_LIMITED
    return map_http_status_to_code(status)


def _safe_message(code: ProviderErrorCode) -> str:
    return {
        ProviderErrorCode.PROVIDER_AUTH_FAILED: "Provider authentication failed",
        ProviderErrorCode.PROVIDER_PERMISSION_DENIED: "Provider permission was denied",
        ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED: "Provider quota has been exhausted",
        ProviderErrorCode.PROVIDER_RATE_LIMITED: "Provider rate limit has been reached",
        ProviderErrorCode.PROVIDER_MODEL_NOT_FOUND: "The configured model was not found",
        ProviderErrorCode.PROVIDER_UNSUPPORTED_MODEL: "The configured model is not supported",
        ProviderErrorCode.PROVIDER_BAD_REQUEST: "Provider rejected the request",
        ProviderErrorCode.PROVIDER_ENDPOINT_NOT_FOUND: "The provider endpoint was not found",
        ProviderErrorCode.PROVIDER_TIMEOUT: "Provider request timed out",
        ProviderErrorCode.PROVIDER_INTERNAL_ERROR: "Provider service returned an error",
    }.get(code, "AI provider request failed")


def _redacted_vendor_body(raw_body: str) -> str:
    if not raw_body:
        return ""
    try:
        value = json.loads(raw_body)
        value = _redact_json(value)
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        text = raw_body
    text = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1[REDACTED]", text)
    text = re.sub(r"(?i)(api[_ -]?key\s*[:=]\s*)[^\s,;\"']+", r"\1[REDACTED]", text)
    text = re.sub(r"\bsk-[A-Za-z0-9_-]{8,}\b", "[REDACTED]", text)
    return text[:400]


def _redact_json(value):
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if any(token in str(key).lower() for token in (
                "api_key", "apikey", "authorization", "token", "secret", "password", "prompt", "content"
            )) else _redact_json(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_json(item) for item in value]
    return value


def openai_models_path(base_url: str) -> str:
    """Avoid duplicating ``/v1`` when the base URL already ends with it."""
    normalised = normalize_base_url(base_url)
    if normalised.endswith("/v1"):
        return "/models"
    return "/v1/models"
