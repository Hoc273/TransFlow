"""Structured JSON logging configuration for the AI microservice.

Provides three separate log channels:
  - internal:   full exception stack traces + context (never sent to frontend)
  - provider:   raw upstream provider responses (status, headers, truncated body)
  - frontend:   the final ProviderErrorDetail shape sent to the caller

No stack traces, API keys, or raw vendor messages are ever logged to
the frontend channel.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone


class _JsonFormatter(logging.Formatter):
    """Formats log records as JSON lines with structured fields."""

    def format(self, record: logging.LogRecord) -> str:
        obj = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "channel": getattr(record, "channel", "internal"),
            "message": record.getMessage(),
        }
        # Attach structured extra fields if present.
        extra_fields = ("errorCode", "provider", "protocol", "capability",
                        "retryable", "httpStatus", "vendorStatus", "vendorBody",
                        "recommendedAction", "details", "manifestVersion", "runId",
                        "stageId", "attempt", "engine", "durationMs", "executionTimeMs",
                        "downloadTimeMs", "engineTimeMs", "uploadTimeMs",
                        "manifestGenerationTimeMs", "storageVerificationTimeMs",
                        "materializationTimeMs", "model", "profile", "inputBytes",
                        "outputBytes", "stemCount", "admissionWaitMs")
        for field in extra_fields:
            value = getattr(record, field, None)
            if value is not None:
                obj[field] = value

        if record.exc_info and record.exc_info[1] is not None:
            # Only include trace on internal channel; never on frontend/provider.
            channel = getattr(record, "channel", "internal")
            if channel == "internal":
                obj["exception"] = self.formatException(record.exc_info)

        return json.dumps(obj, ensure_ascii=False, default=str)


def setup_logging(*, level: str = "INFO") -> None:
    """Configure root logger with JSON formatter and three named child loggers."""
    root = logging.getLogger("transflow.ai")
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root.handlers.clear()
    root.addHandler(handler)

    # Ensure child loggers propagate to root (no separate handlers).
    for name in ("internal", "provider", "frontend"):
        child = root.getChild(name)
        child.setLevel(logging.DEBUG)
        child.propagate = True


def get_internal_logger(name: str) -> logging.Logger:
    """Logger for internal diagnostics — may include stack traces."""
    logger = logging.getLogger(f"transflow.ai.internal.{name}")
    return _ChannelAdapter(logger, "internal")


def get_provider_logger(name: str) -> logging.Logger:
    """Logger for raw upstream provider responses — no API keys."""
    logger = logging.getLogger(f"transflow.ai.provider.{name}")
    return _ChannelAdapter(logger, "provider")


def get_frontend_logger(name: str) -> logging.Logger:
    """Logger for the final error shape sent to callers — no traces/keys."""
    logger = logging.getLogger(f"transflow.ai.frontend.{name}")
    return _ChannelAdapter(logger, "frontend")


def get_debug_logger(name: str) -> logging.Logger:
    """Logger for wire-level DEBUG dumps (full request body + raw response).

    Use only when ``settings.debug_llm_wire`` is True. These dumps are
    intended for off-line diagnosis; they include full message content.
    """
    logger = logging.getLogger(f"transflow.ai.debug.{name}")
    return _ChannelAdapter(logger, "debug")


class _ChannelAdapter(logging.LoggerAdapter):
    """Injects a ``channel`` extra field into every log record."""

    def __init__(self, logger: logging.Logger, channel: str) -> None:
        super().__init__(logger, {"channel": channel})
        self.channel = channel

    def process(self, msg: str, kwargs: dict) -> tuple[str, dict]:
        kwargs.setdefault("extra", {})
        kwargs["extra"]["channel"] = self.channel
        return msg, kwargs
