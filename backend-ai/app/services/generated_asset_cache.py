"""Generated Asset Cache — content-addressable TTS asset store (ADR-CEP A2.1).

Pure optimization layer, entirely inside ``backend-ai``:

* Cache key — canonical JSON array ``sha256([provider_identity, resolved_model,
  voice, text, speed, mime_type])``; ``provider_identity`` itself is a staged
  hash ``sha256([protocol, normalized_base_url])`` so endpoints are isolated
  without leaking the URL and rotated API keys never invalidate the cache.
* Storage — MinIO under ``{gen_cache_prefix}/tts/{protocol}/{voice}/{hash}.{ext}``
  (namespace ``generated-assets/v1``, Q-M-TTS-09). Every object carries a
  provenance metadata blob (13 fields) incl. ``generator_version`` and
  ``execution_info_revision``; a mismatch turns ``get`` into a miss that
  overwrites the same key on ``put``.
* Fail-open — disabled (``GEN_CACHE_ENABLED=false``), missing media
  credentials, or a MinIO constructor failure all yield ``NoopGeneratedAssetCache``
  (no client, no I/O). Any cache error at runtime logs and falls back to live
  synthesis; it can never block the pipeline.
* TTL (Q-M-TTS-10) — "refresh-by-size HEAD": after ``GEN_CACHE_TTL_SECONDS`` the
  cache re-verifies object presence/size with a HEAD (stat); a valid object is
  still a hit, a failed HEAD is a miss. Never deletes by TTL.
* LRU — the sweeper evicts by in-memory ``last_access`` (fallback: ``created_at``
  metadata via HEAD for objects unknown to this process) until the total size
  fits ``GEN_CACHE_CAP_BYTES``; scope is strictly ``{prefix}/tts/``.
* hit_count/last_access flush — best-effort, every ``GEN_CACHE_FLUSH_INTERVAL``:
  server-side ``copy_object`` that MERGES the existing user metadata and keeps
  the content type (atomic in S3 — failure leaves the original object intact).
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import logging
import threading
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Protocol

from app.core.config import settings
from app.schemas.contract import ProviderPayload
from app.services.protocol.types import TtsCacheDescriptor

_log = logging.getLogger("transflow.ai")

#: Wire revision of the execution_info/metadata contract (ADR-CEP §9, v1).
EXECUTION_INFO_REVISION = "1"

#: Capability namespace inside the prefix — sweeper scope is `{prefix}/tts/`.
_CAPABILITY_DIR = "tts"

_MIME_EXTENSIONS = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
}


def _canonical_json(values: list[Any]) -> bytes:
    """Canonical UTF-8 serialization: JSON array keeps field boundaries.

    Direct string concatenation could merge field combinations into the same
    byte stream; a JSON array cannot.
    """
    return json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _normalize_base_url(base_url: str) -> str:
    """Lowercase scheme/host, drop trailing slash; keep path (may be case-sensitive)."""
    parts = urllib.parse.urlsplit(base_url)
    host = (parts.hostname or "").lower()
    port = f":{parts.port}" if parts.port else ""
    path = parts.path.rstrip("/")
    return f"{parts.scheme.lower()}://{host}{port}{path}"


def _sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


@dataclass(frozen=True)
class CacheKeyMaterial:
    """Everything the cache needs to address and describe one generated asset."""

    provider_identity: str  # sha256([protocol, normalized_base_url])
    provider_protocol: str
    hash: str  # sha256([provider_identity, model, voice, text, speed, mime])
    extension: str
    resolved_model: str
    voice: str
    mime_type: str
    speed: str = "1.0"


def build_cache_key(
    provider: ProviderPayload,
    descriptor: TtsCacheDescriptor,
    voice_id: str,
    text: str,
) -> CacheKeyMaterial:
    """Build the content-addressable key material from the pre-synthesis descriptor."""
    provider_identity = _sha256_hex(
        _canonical_json([provider.protocol, _normalize_base_url(provider.base_url)])
    )
    digest = _sha256_hex(
        _canonical_json(
            [
                provider_identity,
                descriptor.resolved_model,
                voice_id,
                text,
                descriptor.speed,
                descriptor.mime_type,
            ]
        )
    )
    extension = _MIME_EXTENSIONS.get(descriptor.mime_type) or descriptor.mime_type.split("/")[-1]
    return CacheKeyMaterial(
        provider_identity=provider_identity,
        provider_protocol=provider.protocol,
        hash=digest,
        extension=extension,
        resolved_model=descriptor.resolved_model,
        voice=voice_id,
        mime_type=descriptor.mime_type,
        speed=descriptor.speed,
    )


def _safe_segment(value: str) -> str:
    """Object-key-safe segment: voice/protocol ids never contain '/', but never trust input."""
    return value.replace("/", "_")


# ── Metadata ─────────────────────────────────────────────────────────────────

_META_USER_KEY = "x-amz-meta-tf-meta"
_META_HASH_KEY = "x-amz-meta-tf-hash"


def build_metadata(material: CacheKeyMaterial, data: bytes, created_at: float) -> dict[str, str]:
    """Provenance metadata (13 fields) for one cached object (A2.1)."""
    payload = {
        "kind": "tts",
        "capability": "tts",
        "hash": material.hash,
        "provider_identity": material.provider_identity,
        "provider_protocol": material.provider_protocol,
        "model": material.resolved_model,
        "voice": material.voice,
        "byte_size": str(len(data)),
        "created_at": _iso_ts(created_at),
        "last_access": _iso_ts(created_at),
        "generator_version": settings.app_version,
        "execution_info_revision": EXECUTION_INFO_REVISION,
        "content_type": material.mime_type,
    }
    return {_META_USER_KEY: json.dumps(payload), _META_HASH_KEY: material.hash}


def _iso_ts(timestamp: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(timestamp))


def _parse_metadata(metadata: dict[str, Any]) -> dict[str, Any] | None:
    blob = metadata.get(_META_USER_KEY) or metadata.get(_META_USER_KEY.title().replace("-", "-"))
    if not blob:
        return None
    try:
        parsed = json.loads(blob)
        return parsed if isinstance(parsed, dict) else None
    except (ValueError, TypeError):
        return None


# ── In-memory stats (LRU + TTL + hit_count) ──────────────────────────────────


@dataclass
class _Entry:
    size: int
    last_access: float
    hit_count: int
    verified_at: float
    dirty: bool = False


# ── Public protocol ───────────────────────────────────────────────────────────


class GeneratedAssetCache(Protocol):
    """Stateless content-addressable cache port (adapter-agnostic)."""

    def object_key(self, material: CacheKeyMaterial) -> str: ...

    async def get(self, material: CacheKeyMaterial) -> bytes | None: ...

    async def put(self, material: CacheKeyMaterial, data: bytes) -> None: ...

    async def exists(self, material: CacheKeyMaterial) -> bool: ...

    async def delete(self, object_key: str) -> None: ...

    async def flush_hit_counts(self) -> None: ...

    async def sweep(self) -> None: ...


class NoopGeneratedAssetCache:
    """Fail-open cache: every operation is a documented no-op.

    Returned when the cache is disabled, media credentials are missing, or the
    MinIO client cannot be constructed — never created, never any I/O.
    """

    def object_key(self, material: CacheKeyMaterial) -> str:
        return f"{settings.gen_cache_prefix.rstrip('/')}/{_CAPABILITY_DIR}/"

    async def get(self, material: CacheKeyMaterial) -> bytes | None:
        return None

    async def put(self, material: CacheKeyMaterial, data: bytes) -> None:
        return None

    async def exists(self, material: CacheKeyMaterial) -> bool:
        return False

    async def delete(self, object_key: str) -> None:
        return None

    async def flush_hit_counts(self) -> None:
        return None

    async def sweep(self) -> None:
        return None


class InMemoryGeneratedAssetCache:
    """Deterministic storage double for unit tests and local contract fixtures.

    Mirrors MinIO semantics: TTL → HEAD refresh (a failed HEAD is a miss),
    provenance-version mismatch → miss, LRU sweep by last_access with
    ``created_at`` fallback, best-effort flush that merges metadata.
    """

    def __init__(
        self,
        *,
        cap_bytes: int = 1024 * 1024 * 1024,
        ttl_seconds: int = 86400,
        prefix: str = "generated-assets/v1",
    ) -> None:
        self.cap_bytes = cap_bytes
        self.ttl_seconds = ttl_seconds
        self.prefix = prefix.rstrip("/")
        self.objects: dict[str, bytes] = {}
        self.metadata: dict[str, dict[str, Any]] = {}
        self.stats: dict[str, _Entry] = {}
        self.stat_fails: set[str] = set()  # keys where HEAD (stat) fails

    def object_key(self, material: CacheKeyMaterial) -> str:
        return (
            f"{self.prefix}/{_CAPABILITY_DIR}/{_safe_segment(material.provider_protocol)}/"
            f"{_safe_segment(material.voice)}/{material.hash}.{material.extension}"
        )

    def _stat_ok(self, object_key: str) -> bool:
        return object_key not in self.stat_fails and object_key in self.objects

    async def _stat(self, object_key: str) -> bool:
        if not self._stat_ok(object_key):
            return False
        entry = self.stats.setdefault(
            object_key,
            _Entry(size=len(self.objects[object_key]), last_access=time.time(), hit_count=0, verified_at=time.time()),
        )
        entry.verified_at = time.time()
        entry.size = len(self.objects[object_key])
        return True

    async def get(self, material: CacheKeyMaterial) -> bytes | None:
        object_key = self.object_key(material)
        if object_key not in self.objects:
            return None
        meta = self.metadata.get(object_key)
        if meta is None:
            return None
        if meta.get("generator_version") != settings.app_version or meta.get("execution_info_revision") != EXECUTION_INFO_REVISION:
            return None
        entry = self.stats.setdefault(
            object_key,
            _Entry(size=len(self.objects[object_key]), last_access=time.time(), hit_count=0, verified_at=time.time()),
        )
        if time.time() - entry.verified_at > self.ttl_seconds:
            if not await self._stat(object_key):
                return None
        entry.last_access = time.time()
        entry.hit_count += 1
        entry.dirty = True
        return self.objects[object_key]

    async def put(self, material: CacheKeyMaterial, data: bytes) -> None:
        object_key = self.object_key(material)
        self.objects[object_key] = data
        created = time.time()
        self.metadata[object_key] = {
            "kind": "tts",
            "capability": "tts",
            "hash": material.hash,
            "provider_identity": material.provider_identity,
            "provider_protocol": material.provider_protocol,
            "model": material.resolved_model,
            "voice": material.voice,
            "byte_size": str(len(data)),
            "created_at": _iso_ts(created),
            "last_access": _iso_ts(created),
            "generator_version": settings.app_version,
            "execution_info_revision": EXECUTION_INFO_REVISION,
            "content_type": material.mime_type,
        }
        self.stats[object_key] = _Entry(size=len(data), last_access=created, hit_count=0, verified_at=created)

    async def exists(self, material: CacheKeyMaterial) -> bool:
        return await self._stat(self.object_key(material))

    async def delete(self, object_key: str) -> None:
        self.objects.pop(object_key, None)
        self.metadata.pop(object_key, None)
        self.stats.pop(object_key, None)
        self.stat_fails.discard(object_key)

    async def flush_hit_counts(self) -> None:
        for object_key, entry in list(self.stats.items()):
            if entry.dirty:
                entry.dirty = False
                meta = self.metadata.get(object_key)
                if meta is not None:
                    meta["last_access"] = _iso_ts(entry.last_access)

    async def sweep(self) -> None:
        total = sum(entry.size for entry in self.stats.values())
        if total <= self.cap_bytes:
            return
        ordered = sorted(
            self.stats.items(),
            key=lambda item: item[1].last_access,
        )
        for object_key, _entry in ordered:
            if total <= self.cap_bytes:
                break
            total -= _entry.size
            await self.delete(object_key)


class MinioGeneratedAssetCache:
    """S3/MinIO implementation (sync client, I/O offloaded to worker threads).

    Never raises out of ``get``/``put``/``exists`` — cache failures are logged
    and surface as a miss (the gateway then synthesizes live).
    """

    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        prefix: str,
        secure: bool = False,
        cap_bytes: int = 1024 * 1024 * 1024,
        ttl_seconds: int = 86400,
    ) -> None:
        from minio import Minio

        if not access_key or not secret_key:
            raise ValueError("media storage credentials must be configured for the asset cache")
        host = endpoint.removeprefix("http://").removeprefix("https://")
        self._client = Minio(host, access_key=access_key, secret_key=secret_key, secure=secure)
        self._bucket = bucket
        self._prefix = prefix.rstrip("/")
        self._cap_bytes = cap_bytes
        self._ttl_seconds = ttl_seconds
        self._stats: dict[str, _Entry] = {}

    def _tts_prefix(self) -> str:
        return f"{self._prefix}/{_CAPABILITY_DIR}/"

    def object_key(self, material: CacheKeyMaterial) -> str:
        return (
            f"{self._tts_prefix()}{_safe_segment(material.provider_protocol)}/"
            f"{_safe_segment(material.voice)}/{material.hash}.{material.extension}"
        )

    # ── get / put / exists / delete ──────────────────────────────────────────

    async def get(self, material: CacheKeyMaterial) -> bytes | None:
        object_key = self.object_key(material)
        try:
            result = await asyncio.to_thread(self._get_sync, object_key)
        except Exception:
            _log.exception("Generated asset cache GET failed for %s", object_key)
            return None
        if result is None:
            return None
        entry = self._stats.setdefault(
            object_key,
            _Entry(size=len(result), last_access=time.time(), hit_count=0, verified_at=time.time()),
        )
        entry.last_access = time.time()
        entry.hit_count += 1
        entry.dirty = True
        return result

    def _get_sync(self, object_key: str) -> bytes | None:
        from minio.error import S3Error

        entry = self._stats.get(object_key)
        needs_stat = entry is None or (time.time() - entry.verified_at > self._ttl_seconds)
        if needs_stat:
            try:
                stat = self._client.stat_object(self._bucket, object_key)
            except S3Error:
                return None
            meta = _parse_metadata(stat.metadata)
            if meta is None or meta.get("generator_version") != settings.app_version or meta.get("execution_info_revision") != EXECUTION_INFO_REVISION:
                return None
            entry = self._stats.setdefault(
                object_key,
                _Entry(size=stat.size, last_access=time.time(), hit_count=0, verified_at=time.time()),
            )
            entry.size = stat.size
            entry.verified_at = time.time()
        try:
            response = self._client.get_object(self._bucket, object_key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()
        except Exception:
            return None

    async def put(self, material: CacheKeyMaterial, data: bytes) -> None:
        object_key = self.object_key(material)
        try:
            await asyncio.to_thread(self._put_sync, material, object_key, data)
            self._stats[object_key] = _Entry(
                size=len(data), last_access=time.time(), hit_count=0, verified_at=time.time()
            )
        except Exception:
            _log.exception("Generated asset cache PUT failed for %s", object_key)

    def _put_sync(self, material: CacheKeyMaterial, object_key: str, data: bytes) -> None:
        self._client.put_object(
            self._bucket,
            object_key,
            io.BytesIO(data),
            length=len(data),
            content_type=material.mime_type,
            metadata=build_metadata(material, data, time.time()),
        )

    async def exists(self, material: CacheKeyMaterial) -> bool:
        return await self.get(material) is not None

    async def delete(self, object_key: str) -> None:
        try:
            await asyncio.to_thread(self._client.remove_object, self._bucket, object_key)
        except Exception:
            _log.exception("Generated asset cache DELETE failed for %s", object_key)
        self._stats.pop(object_key, None)

    # ── Flush (hit_count / last_access → metadata, merged, atomic copy) ──────

    async def flush_hit_counts(self) -> None:
        dirty = [key for key, entry in self._stats.items() if entry.dirty]
        if not dirty:
            return
        try:
            await asyncio.to_thread(self._flush_sync, dirty)
        except Exception:
            _log.exception("Generated asset cache flush failed")

    def _flush_sync(self, object_keys: list[str]) -> None:
        from minio.api import CopySource

        for object_key in object_keys:
            entry = self._stats.get(object_key)
            if entry is None:
                continue
            stat = self._client.stat_object(self._bucket, object_key)
            meta = _parse_metadata(stat.metadata)
            if meta is None:
                entry.dirty = False  # foreign object — never rewrite; drop from retries
                continue
            meta["last_access"] = _iso_ts(entry.last_access)
            meta["byte_size"] = str(entry.size)
            # REPLACE directive: user metadata becomes exactly _user_meta_dict
            # (all provenance fields survive inside the merged blob). The
            # content type travels inside the metadata dict — MinIO 7.x
            # copy_object() has NO content_type parameter, and normalize_headers
            # forwards the standard "Content-Type" header verbatim (P0 fix).
            # Server-side copy is atomic — a failure leaves the original object
            # intact and entry.dirty=True so the next flush cycle retries.
            self._client.copy_object(
                self._bucket,
                object_key,
                CopySource(self._bucket, object_key),
                metadata=_user_meta_dict(meta),
                metadata_directive="REPLACE",
            )
            entry.dirty = False

    # ── Sweeper (LRU, scope {prefix}/tts/, fallback created_at) ─────────────

    async def sweep(self) -> None:
        try:
            await asyncio.to_thread(self._sweep_sync)
        except Exception:
            _log.exception("Generated asset cache sweep failed")

    def _sweep_sync(self) -> None:
        from minio.error import S3Error

        candidates: list[tuple[str, int, float]] = []  # (key, size, last_access)
        total = 0
        for obj in self._client.list_objects(self._bucket, prefix=self._tts_prefix(), recursive=True):
            size = obj.size
            total += size
            entry = self._stats.get(obj.object_name)
            if entry is not None:
                candidates.append((obj.object_name, size, entry.last_access))
                continue
            created = 0.0
            try:
                stat = self._client.stat_object(self._bucket, obj.object_name)
                meta = _parse_metadata(stat.metadata)
                if meta and meta.get("created_at"):
                    created = time.mktime(time.strptime(meta["created_at"], "%Y-%m-%dT%H:%M:%SZ"))
            except S3Error:
                pass
            candidates.append((obj.object_name, size, created))
        if total <= self._cap_bytes:
            return
        for object_key, size, _last in sorted(candidates, key=lambda item: item[2]):
            if total <= self._cap_bytes:
                break
            try:
                self._client.remove_object(self._bucket, object_key)
            except S3Error:
                continue
            total -= size
            self._stats.pop(object_key, None)


def _user_meta_dict(meta: dict[str, Any]) -> dict[str, str]:
    """User metadata dict for put/copy — keys must be x-amz-meta prefixed.

    ``Content-Type`` is deliberately a bare standard header here: MinIO 7.x
    ``copy_object()`` accepts only ``metadata`` + ``metadata_directive`` (no
    ``content_type`` kwarg), and ``normalize_headers`` forwards the standard
    ``Content-Type`` verbatim while x-amz-meta-* keys become user metadata.
    """
    return {
        _META_USER_KEY: json.dumps(meta),
        _META_HASH_KEY: str(meta.get("hash", "")),
        "Content-Type": str(meta.get("content_type") or "application/octet-stream"),
    }


# ── Lazy fail-open factory + background maintenance ───────────────────────────

_override: GeneratedAssetCache | None = None
_cache: GeneratedAssetCache | None = None
_build_lock = threading.Lock()
_tasks: list[asyncio.Task] = []


def set_cache_override(cache: GeneratedAssetCache | None) -> None:
    """Test hook — installs a deterministic double; None restores real behavior."""
    global _override, _cache
    _override = cache
    _cache = None


def get_cache() -> GeneratedAssetCache:
    """Lazily build the process-wide cache; any failure → Noop (fail-open)."""
    global _cache
    if _override is not None:
        return _override
    if _cache is not None:
        return _cache
    with _build_lock:
        if _cache is None:
            _cache = _build_cache()
    return _cache


def _build_cache() -> GeneratedAssetCache:
    if not settings.gen_cache_enabled:
        _log.info("Generated asset cache disabled (GEN_CACHE_ENABLED=false) → Noop")
        return NoopGeneratedAssetCache()
    if not settings.media_storage_access_key or not settings.media_storage_secret_key:
        _log.warning("Media storage credentials missing → generated asset cache Noop")
        return NoopGeneratedAssetCache()
    try:
        return MinioGeneratedAssetCache(
            endpoint=settings.media_storage_endpoint,
            access_key=settings.media_storage_access_key,
            secret_key=settings.media_storage_secret_key,
            bucket=settings.media_storage_bucket,
            prefix=settings.gen_cache_prefix,
            secure=settings.media_storage_secure,
            cap_bytes=settings.gen_cache_cap_bytes,
            ttl_seconds=settings.gen_cache_ttl_seconds,
        )
    except Exception as exc:
        _log.warning("Generated asset cache unavailable (%s) → Noop", exc)
        return NoopGeneratedAssetCache()


async def start_background_maintenance() -> None:
    """Start sweeper + hit_count flush loops (best-effort, never crash runtime)."""
    cache = get_cache()
    if isinstance(cache, NoopGeneratedAssetCache):
        return
    _tasks.clear()

    async def _sweep_loop() -> None:
        while True:
            await asyncio.sleep(max(60, settings.gen_cache_sweep_interval))
            try:
                await cache.sweep()
            except Exception:
                _log.exception("Generated asset cache sweep loop error")

    async def _flush_loop() -> None:
        while True:
            await asyncio.sleep(max(5, settings.gen_cache_flush_interval))
            try:
                await cache.flush_hit_counts()
            except Exception:
                _log.exception("Generated asset cache flush loop error")

    _tasks.append(asyncio.create_task(_sweep_loop()))
    _tasks.append(asyncio.create_task(_flush_loop()))


async def stop_background_maintenance() -> None:
    for task in _tasks:
        task.cancel()
    _tasks.clear()


# ── Single-flight (per-key, per-process) ──────────────────────────────────────


class SingleFlight:
    """Deduplicate concurrent same-key misses within this process.

    Lock ordering: acquire key lock → re-check the cache inside the lock →
    synthesize on miss → put → release. N concurrent requests for the same key
    therefore perform exactly one engine call. Cross-replica duplication is
    prevented by content-addressing (identical bytes overwrite harmlessly).

    Memory bound: a per-key lock is reclaimed once no caller holds or waits on
    it (reference-counted under the guard), so a long-lived process with many
    distinct keys never accumulates stale locks (P1 fix).
    """

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        self._refs: dict[str, int] = {}
        self._guard = asyncio.Lock()

    async def run(
        self,
        key: str,
        coro_factory: Callable[[], Awaitable[Any]],
    ) -> Any:
        async with self._guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[key] = lock
            self._refs[key] = self._refs.get(key, 0) + 1
        try:
            async with lock:
                return await coro_factory()
        finally:
            async with self._guard:
                remaining = self._refs[key] - 1
                if remaining <= 0:
                    self._refs.pop(key, None)
                    self._locks.pop(key, None)
                else:
                    self._refs[key] = remaining
