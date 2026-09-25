"""Unified provider exception hierarchy + error-code catalog (mirrors Java ProviderErrorCode).

This replaces the three parallel error classes (LLMError, STTError,
TTSProviderError) with a single hierarchy carrying structured metadata
that Spring Boot can map directly into ProviderErrorResponse.

Error codes are a StrEnum so they serialise as plain strings matching
the Java ProviderErrorCode names exactly.
"""
from __future__ import annotations

from enum import StrEnum
from typing import Mapping


# ── Error-code catalog ──────────────────────────────────────────────────

class ProviderErrorCode(StrEnum):
    """Machine-readable error codes — single source of truth for retry, HTTP status, and UI."""

    # Authentication
    PROVIDER_AUTH_FAILED = "PROVIDER_AUTH_FAILED"
    PROVIDER_PERMISSION_DENIED = "PROVIDER_PERMISSION_DENIED"

    # Rate limiting
    PROVIDER_RATE_LIMITED = "PROVIDER_RATE_LIMITED"

    # Timeout
    PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"

    # Transport / network
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    PROVIDER_NETWORK_ERROR = "PROVIDER_NETWORK_ERROR"
    PROVIDER_SSL_ERROR = "PROVIDER_SSL_ERROR"
    PROVIDER_TRANSPORT_ERROR = "PROVIDER_TRANSPORT_ERROR"

    # Configuration
    PROVIDER_INVALID_BASE_URL = "PROVIDER_INVALID_BASE_URL"
    PROVIDER_ENDPOINT_NOT_FOUND = "PROVIDER_ENDPOINT_NOT_FOUND"
    PROVIDER_UNSUPPORTED_PROTOCOL = "PROVIDER_UNSUPPORTED_PROTOCOL"
    PROVIDER_UNSUPPORTED_MODEL = "PROVIDER_UNSUPPORTED_MODEL"
    PROVIDER_UNSUPPORTED_ENDPOINT = "PROVIDER_UNSUPPORTED_ENDPOINT"

    # Capability
    PROVIDER_UNSUPPORTED_CAPABILITY = "PROVIDER_UNSUPPORTED_CAPABILITY"
    PROVIDER_VOICE_DISCOVERY_UNSUPPORTED = "PROVIDER_VOICE_DISCOVERY_UNSUPPORTED"

    # Validation
    PROVIDER_VALIDATION_FAILED = "PROVIDER_VALIDATION_FAILED"
    PROVIDER_BAD_REQUEST = "PROVIDER_BAD_REQUEST"
    PROVIDER_RESPONSE_MALFORMED = "PROVIDER_RESPONSE_MALFORMED"
    PROVIDER_EMPTY_RESPONSE = "PROVIDER_EMPTY_RESPONSE"
    PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION = "PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION"

    # Provider-specific
    PROVIDER_MODEL_NOT_FOUND = "PROVIDER_MODEL_NOT_FOUND"
    PROVIDER_CONTENT_FILTERED = "PROVIDER_CONTENT_FILTERED"
    PROVIDER_CONTEXT_LENGTH_EXCEEDED = "PROVIDER_CONTEXT_LENGTH_EXCEEDED"
    PROVIDER_QUOTA_EXCEEDED = "PROVIDER_QUOTA_EXCEEDED"
    PROVIDER_ACCOUNT_SUSPENDED = "PROVIDER_ACCOUNT_SUSPENDED"
    PROVIDER_INTERNAL_ERROR = "PROVIDER_INTERNAL_ERROR"

    # Media-specific
    PROVIDER_STT_CODEC_UNSUPPORTED = "PROVIDER_STT_CODEC_UNSUPPORTED"
    PROVIDER_STT_NO_AUDIO_STREAM = "PROVIDER_STT_NO_AUDIO_STREAM"
    PROVIDER_TTS_VOICE_NOT_FOUND = "PROVIDER_TTS_VOICE_NOT_FOUND"
    PROVIDER_RENDER_FAILED = "PROVIDER_RENDER_FAILED"

    # Catch-all
    PROVIDER_UNKNOWN = "PROVIDER_UNKNOWN"


# ── Metadata registry ──────────────────────────────────────────────────

# (http_status, title, retryable, recommended_action, documentation)
_CODE_META: dict[ProviderErrorCode, tuple[int, str, bool, str, str]] = {
    ProviderErrorCode.PROVIDER_AUTH_FAILED: (
        401, "Authentication Failed", False,
        "Check your API key for typos and ensure it is active.",
        "/docs/providers#api-keys",
    ),
    ProviderErrorCode.PROVIDER_PERMISSION_DENIED: (
        403, "Permission Denied", False,
        "Grant the required permission or manually configure the resource.",
        "/docs/providers#permissions",
    ),
    ProviderErrorCode.PROVIDER_RATE_LIMITED: (
        429, "Rate Limited", True,
        "Wait a moment and try again, or upgrade your provider plan.",
        "/docs/providers#rate-limits",
    ),
    ProviderErrorCode.PROVIDER_TIMEOUT: (
        504, "Provider Timeout", True,
        "The provider took too long to respond. Try again later.",
        "/docs/providers#timeout",
    ),
    ProviderErrorCode.PROVIDER_UNAVAILABLE: (
        502, "Provider Unavailable", True,
        "The provider service is down or unreachable. Try again later.",
        "/docs/providers#availability",
    ),
    ProviderErrorCode.PROVIDER_NETWORK_ERROR: (
        502, "Network Error", True,
        "Check your network connection and provider base URL.",
        "/docs/providers#network",
    ),
    ProviderErrorCode.PROVIDER_SSL_ERROR: (
        502, "SSL Error", False,
        "Ensure the provider endpoint uses a valid TLS certificate.",
        "/docs/providers#ssl",
    ),
    ProviderErrorCode.PROVIDER_TRANSPORT_ERROR: (
        502, "Transport Error", True,
        "A low-level network error occurred. Try again later.",
        "/docs/providers#network",
    ),
    ProviderErrorCode.PROVIDER_INVALID_BASE_URL: (
        400, "Invalid Base URL", False,
        "Check the base URL format (e.g. https://api.example.com/v1).",
        "/docs/providers#base-url",
    ),
    ProviderErrorCode.PROVIDER_ENDPOINT_NOT_FOUND: (
        404, "Endpoint Not Found", False,
        "Verify the provider supports this endpoint and the base URL is correct.",
        "/docs/providers#endpoints",
    ),
    ProviderErrorCode.PROVIDER_UNSUPPORTED_PROTOCOL: (
        400, "Unsupported Protocol", False,
        "Choose a supported protocol (openai_compatible, anthropic, elevenlabs_native, dashscope_native, …).",
        "/docs/providers#protocols",
    ),
    ProviderErrorCode.PROVIDER_UNSUPPORTED_MODEL: (
        400, "Unsupported Model", False,
        "Select a model that the provider supports.",
        "/docs/providers#models",
    ),
    ProviderErrorCode.PROVIDER_UNSUPPORTED_ENDPOINT: (
        404, "Unsupported Endpoint", False,
        "This endpoint is not available for the selected provider protocol.",
        "/docs/providers#endpoints",
    ),
    ProviderErrorCode.PROVIDER_UNSUPPORTED_CAPABILITY: (
        422, "Unsupported Capability", False,
        "Enable the required capability for this provider or choose a different one.",
        "/docs/providers#capabilities",
    ),
    ProviderErrorCode.PROVIDER_VOICE_DISCOVERY_UNSUPPORTED: (
        422, "Voice Discovery Unsupported", False,
        "This provider does not expose a voice list. Manually configure a Voice ID.",
        "/docs/providers#tts-voices",
    ),
    ProviderErrorCode.PROVIDER_VALIDATION_FAILED: (
        400, "Validation Failed", False,
        "Review the highlighted fields and correct the errors.",
        "/docs/providers#validation",
    ),
    ProviderErrorCode.PROVIDER_BAD_REQUEST: (
        400, "Bad Request", False,
        "The request payload is invalid. Check the input parameters.",
        "/docs/providers#request-format",
    ),
    ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED: (
        502, "Response Malformed", True,
        "The provider returned unexpected data. Try again or switch models.",
        "/docs/providers#response-format",
    ),
    ProviderErrorCode.PROVIDER_EMPTY_RESPONSE: (
        502, "Empty Response", True,
        "The provider returned no output. Try again or switch models.",
        "/docs/providers#empty-response",
    ),
    ProviderErrorCode.PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION: (
        502, "Output Business Rule Violation", False,
        "The AI output violated a business rule and cannot be auto-fixed. Review manually.",
        "/docs/providers#business-rules",
    ),
    ProviderErrorCode.PROVIDER_MODEL_NOT_FOUND: (
        404, "Model Not Found", False,
        "The requested model does not exist at this provider. Choose a valid model name.",
        "/docs/providers#models",
    ),
    ProviderErrorCode.PROVIDER_CONTENT_FILTERED: (
        400, "Content Filtered", False,
        "The provider filtered the content for policy reasons. Adjust the input.",
        "/docs/providers#content-filter",
    ),
    ProviderErrorCode.PROVIDER_CONTEXT_LENGTH_EXCEEDED: (
        400, "Context Length Exceeded", False,
        "Shorten the input text or switch to a model with a larger context window.",
        "/docs/providers#context-length",
    ),
    ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED: (
        429, "Quota Exceeded", False,
        "Your provider quota has been depleted. Upgrade or wait for reset.",
        "/docs/providers#quota",
    ),
    ProviderErrorCode.PROVIDER_ACCOUNT_SUSPENDED: (
        403, "Account Suspended", False,
        "The provider account is suspended. Contact the provider support.",
        "/docs/providers#account",
    ),
    ProviderErrorCode.PROVIDER_INTERNAL_ERROR: (
        502, "Provider Internal Error", True,
        "The provider encountered an internal error. Try again later.",
        "/docs/providers#errors",
    ),
    ProviderErrorCode.PROVIDER_STT_CODEC_UNSUPPORTED: (
        400, "STT Codec Unsupported", False,
        "Upload audio in a supported format (WAV, MP3, FLAC).",
        "/docs/providers#stt-codecs",
    ),
    ProviderErrorCode.PROVIDER_STT_NO_AUDIO_STREAM: (
        400, "No Audio Stream", False,
        "The uploaded file contains no audio stream. Verify the file is a valid audio/video.",
        "/docs/providers#stt-no-audio",
    ),
    ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND: (
        404, "TTS Voice Not Found", False,
        "The selected voice ID does not exist. Refresh the voice list or enter a valid ID.",
        "/docs/providers#tts-voices",
    ),
    ProviderErrorCode.PROVIDER_RENDER_FAILED: (
        500, "Render Failed", True,
        "Video rendering failed. The system will retry automatically.",
        "/docs/providers#render",
    ),
    ProviderErrorCode.PROVIDER_UNKNOWN: (
        500, "Unknown Provider Error", False,
        "An unexpected error occurred. Contact support if it persists.",
        "/docs/providers#support",
    ),
}

# ── Shared retryable-status set (single definition) ─────────────────────

RETRYABLE_HTTP_STATUS: frozenset[int] = frozenset({429, 500, 502, 503, 504})


# ── Helper functions ────────────────────────────────────────────────────

def http_status(code: ProviderErrorCode) -> int:
    return _CODE_META[code][0]

def title(code: ProviderErrorCode) -> str:
    return _CODE_META[code][1]

def is_retryable(code: ProviderErrorCode) -> bool:
    return _CODE_META[code][2]

def recommended_action(code: ProviderErrorCode) -> str:
    return _CODE_META[code][3]

def documentation(code: ProviderErrorCode) -> str:
    return _CODE_META[code][4]

def map_http_status_to_code(status: int, *, provider_label: str = "") -> ProviderErrorCode:
    """Map a raw HTTP status from an upstream provider response to a ProviderErrorCode."""
    if status == 401:
        return ProviderErrorCode.PROVIDER_AUTH_FAILED
    if status == 403:
        return ProviderErrorCode.PROVIDER_PERMISSION_DENIED
    if status == 404:
        return ProviderErrorCode.PROVIDER_ENDPOINT_NOT_FOUND
    if status == 422:
        return ProviderErrorCode.PROVIDER_BAD_REQUEST
    if status == 429:
        return ProviderErrorCode.PROVIDER_RATE_LIMITED
    if status == 504:
        return ProviderErrorCode.PROVIDER_TIMEOUT
    if status in RETRYABLE_HTTP_STATUS:
        return ProviderErrorCode.PROVIDER_INTERNAL_ERROR
    if status >= 500:
        return ProviderErrorCode.PROVIDER_INTERNAL_ERROR
    if status >= 400:
        return ProviderErrorCode.PROVIDER_BAD_REQUEST
    return ProviderErrorCode.PROVIDER_UNKNOWN


# ── Exception hierarchy ─────────────────────────────────────────────────

class ProviderException(Exception):
    """Base exception for all AI-provider failures.

    Carries a structured ProviderErrorCode, contextual metadata
    (provider, protocol, capability), and a client-safe message.
    """

    def __init__(
        self,
        code: ProviderErrorCode,
        message: str,
        *,
        provider: str | None = None,
        protocol: str | None = None,
        capability: str | None = None,
        model: str | None = None,
        details: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.provider = provider
        self.protocol = protocol
        self.capability = capability
        self.model = model
        self.details = details

    @property
    def retryable(self) -> bool:
        return is_retryable(self.code)

    @property
    def http_status(self) -> int:
        return http_status(self.code)

    def to_error_detail(self) -> dict:
        """Serialise to the ProviderErrorDetail shape for HTTP responses."""
        return {
            "errorCode": self.code,
            "title": title(self.code),
            "message": self.message,
            "details": dict(self.details) if self.details else None,
            "provider": self.provider,
            "protocol": self.protocol,
            "capability": self.capability,
            "model": self.model,
            "retryable": self.retryable,
            "recommendedAction": recommended_action(self.code),
            "documentation": documentation(self.code),
        }


# ── Subclass shortcuts ──────────────────────────────────────────────────

class ProviderAuthFailed(ProviderException):
    def __init__(self, message: str, **kw) -> None:
        super().__init__(ProviderErrorCode.PROVIDER_AUTH_FAILED, message, **kw)

class ProviderPermissionDenied(ProviderException):
    def __init__(self, message: str, **kw) -> None:
        super().__init__(ProviderErrorCode.PROVIDER_PERMISSION_DENIED, message, **kw)

class ProviderRateLimited(ProviderException):
    def __init__(self, message: str, **kw) -> None:
        super().__init__(ProviderErrorCode.PROVIDER_RATE_LIMITED, message, **kw)

class ProviderTimeout(ProviderException):
    def __init__(self, message: str, **kw) -> None:
        super().__init__(ProviderErrorCode.PROVIDER_TIMEOUT, message, **kw)

class ProviderTransport(ProviderException):
    """Network-level failure. Callers can override the code for SSL/unavailable sub-cases."""
    def __init__(self, message: str, code: ProviderErrorCode = ProviderErrorCode.PROVIDER_NETWORK_ERROR, **kw) -> None:
        super().__init__(code, message, **kw)

class ProviderConfiguration(ProviderException):
    """Misconfigured provider. Callers can override the code for specific sub-cases."""
    def __init__(self, message: str, code: ProviderErrorCode = ProviderErrorCode.PROVIDER_INVALID_BASE_URL, **kw) -> None:
        super().__init__(code, message, **kw)

class ProviderValidation(ProviderException):
    """Business-rule or capability validation failure."""
    def __init__(self, message: str, code: ProviderErrorCode = ProviderErrorCode.PROVIDER_VALIDATION_FAILED, **kw) -> None:
        super().__init__(code, message, **kw)
