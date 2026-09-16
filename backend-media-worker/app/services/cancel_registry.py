"""In-memory cancel flags for in-flight renders (graceful cancel, docs 15 §9)."""
from __future__ import annotations

import threading
from typing import Set

_lock = threading.Lock()
_cancelled: Set[str] = set()
_active: Set[str] = set()


def register(correlation_id: str) -> None:
    with _lock:
        _active.add(correlation_id)
        _cancelled.discard(correlation_id)


def unregister(correlation_id: str) -> None:
    with _lock:
        _active.discard(correlation_id)
        _cancelled.discard(correlation_id)


def request_cancel(correlation_id: str) -> bool:
    """Mark a render as cancel-requested. Returns True if it was active."""
    with _lock:
        if correlation_id in _active:
            _cancelled.add(correlation_id)
            return True
        _cancelled.add(correlation_id)
        return False


def is_cancelled(correlation_id: str) -> bool:
    with _lock:
        return correlation_id in _cancelled


def active_ids() -> list[str]:
    with _lock:
        return list(_active)
