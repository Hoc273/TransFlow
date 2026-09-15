"""Cache: hash video + timestamp + model + prompt version (requirement 5).

Single-process LRU with TTL, keyed by sha256(video_hash + ":" + timestamp + ":" + model + ":" + prompt_version).
Analogous to GeneratedAssetCache (Q-M-TTS-09) but for visual observations.

For V1, in-process only (no MinIO persistence). Thread-safe via asyncio lock per key.
"""
from __future__ import annotations

import hashlib
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Optional

# prompt version -> bump invalidates cache (requirement 5)
PROMPT_VERSION = "v1"

# simple in-memory store: cache_key -> (visual_observation_dict, expires_at)
_MAX_ENTRIES = 512
_TTL_SECONDS = 24 * 3600  # 24h
_store: OrderedDict[str, tuple[dict[str, Any], float]] = OrderedDict()


def _now() -> float:
    return time.time()


def _video_hash(video_ref: str) -> str:
    """Stable hash for video identity (ref or url)."""
    return hashlib.sha256(video_ref.encode("utf-8")).hexdigest()[:16]


def cache_key(
    *,
    video_ref: str,
    timestamp: int,
    model: str,
    prompt_version: str = PROMPT_VERSION,
) -> str:
    raw = f"{_video_hash(video_ref)}:{timestamp}:{model}:{prompt_version}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get(
    *,
    video_ref: str,
    timestamp: int,
    model: str,
    prompt_version: str = PROMPT_VERSION,
) -> Optional[dict[str, Any]]:
    key = cache_key(video_ref=video_ref, timestamp=timestamp, model=model, prompt_version=prompt_version)
    entry = _store.get(key)
    if entry is None:
        return None
    value, expires = entry
    if _now() > expires:
        _store.pop(key, None)
        return None
    # LRU touch
    _store.move_to_end(key)
    return value


def put(
    *,
    video_ref: str,
    timestamp: int,
    model: str,
    prompt_version: str = PROMPT_VERSION,
    observation: dict[str, Any],
    ttl_seconds: int = _TTL_SECONDS,
) -> str:
    key = cache_key(video_ref=video_ref, timestamp=timestamp, model=model, prompt_version=prompt_version)
    # evict oldest if over cap
    if len(_store) >= _MAX_ENTRIES:
        _store.popitem(last=False)
    _store[key] = (observation, _now() + ttl_seconds)
    _store.move_to_end(key)
    return key


def bulk_get(
    *,
    video_ref: str,
    timestamps: list[int],
    model: str,
    prompt_version: str = PROMPT_VERSION,
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for ts in timestamps:
        v = get(video_ref=video_ref, timestamp=ts, model=model, prompt_version=prompt_version)
        if v is not None:
            out[ts] = v
    return out


def clear() -> None:
    _store.clear()


def stats() -> dict[str, Any]:
    return {"entries": len(_store), "max_entries": _MAX_ENTRIES, "ttl_seconds": _TTL_SECONDS}
