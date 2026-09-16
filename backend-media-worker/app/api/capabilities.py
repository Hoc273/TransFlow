"""Internal capability advertisement endpoint (CT10.2). Not a public API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.core.capability import worker_capability_advertisement

router = APIRouter()


@router.get("/capabilities")
async def capabilities() -> dict[str, Any]:
    return worker_capability_advertisement()
