"""Service-to-service authentication for requests coming from backend-main.

This service holds no user auth of its own, so every endpoint except ``/health``
requires the shared ``X-Internal-Token`` that backend-main sends (RestClientConfig).
Pure ASGI (not BaseHTTPMiddleware) so streamed bodies/responses are untouched.
An empty token disables the check for local dev; production must set
``INTERNAL_SERVICE_TOKEN`` on both sides.
"""
from __future__ import annotations

import hmac
import json
import logging
from typing import Callable

HEADER = b"x-internal-token"
EXEMPT_PATHS = frozenset({"/health"})

log = logging.getLogger(__name__)


class InternalTokenMiddleware:
    def __init__(self, app, token_getter: Callable[[], str]) -> None:
        self.app = app
        self.token_getter = token_getter

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope.get("path") in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return
        expected = (self.token_getter() or "").strip()
        if not expected:
            await self.app(scope, receive, send)
            return
        provided = b""
        for name, value in scope.get("headers") or ():
            if name == HEADER:
                provided = value
                break
        if not hmac.compare_digest(provided, expected.encode("utf-8")):
            log.warning("Rejected request without valid internal token: %s %s",
                        scope.get("method"), scope.get("path"))
            body = json.dumps({"detail": "Missing or invalid internal service token"}).encode("utf-8")
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode("ascii"))],
            })
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
