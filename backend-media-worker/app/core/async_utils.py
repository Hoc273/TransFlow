"""Async boundaries for synchronous media/storage service functions."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any, TypeVar


T = TypeVar("T")


async def blocking(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Run a synchronous service function without blocking the event loop."""
    return await asyncio.to_thread(fn, *args, **kwargs)
