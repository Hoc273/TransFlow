"""Stateless object storage port for source separation.

This module has no Spring, database, or MediaAsset knowledge.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class StoredObject:
    object_ref: str
    file_size_bytes: int
    checksum_sha256: str


class SeparationStorage(Protocol):
    def download(self, object_ref: str, destination: Path) -> None:
        """Download an existing source object to a local path."""

    def upload(self, source: Path, object_key: str, *, content_type: str) -> StoredObject:
        """Upload a local output and return its opaque reference and integrity facts."""

    def delete(self, object_ref: str) -> None:
        """Delete one exact uncommitted output object."""


class MinioSeparationStorage:
    """S3/MinIO-compatible implementation; refs are ``bucket/key`` values."""

    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        secure: bool = False,
    ) -> None:
        from minio import Minio

        if not access_key or not secret_key:
            raise ValueError("media storage credentials must be configured")
        host = endpoint.removeprefix("http://").removeprefix("https://")
        self._bucket = bucket
        self._client = Minio(host, access_key=access_key, secret_key=secret_key, secure=secure)

    def download(self, object_ref: str, destination: Path) -> None:
        bucket, key = _parse_ref(object_ref)
        destination.parent.mkdir(parents=True, exist_ok=True)
        response = self._client.get_object(bucket, key)
        try:
            with destination.open("wb") as handle:
                for chunk in response.stream(1024 * 1024):
                    handle.write(chunk)
        finally:
            response.close()
            response.release_conn()

    def upload(self, source: Path, object_key: str, *, content_type: str) -> StoredObject:
        from minio.error import S3Error

        size, checksum = _file_facts(source)
        try:
            self._client.fput_object(
                self._bucket,
                object_key,
                str(source),
                content_type=content_type,
            )
        except S3Error:
            raise
        return StoredObject(f"{self._bucket}/{object_key}", size, checksum)

    def delete(self, object_ref: str) -> None:
        bucket, key = _parse_ref(object_ref)
        self._client.remove_object(bucket, key)


class InMemorySeparationStorage:
    """Deterministic storage double for unit tests and local contract fixtures."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def download(self, object_ref: str, destination: Path) -> None:
        try:
            data = self.objects[object_ref]
        except KeyError as exc:
            raise FileNotFoundError(object_ref) from exc
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)

    def upload(self, source: Path, object_key: str, *, content_type: str) -> StoredObject:
        data = source.read_bytes()
        self.objects[object_key] = data
        return StoredObject(object_key, len(data), hashlib.sha256(data).hexdigest())

    def delete(self, object_ref: str) -> None:
        self.objects.pop(object_ref, None)


def _parse_ref(object_ref: str) -> tuple[str, str]:
    ref = object_ref.removeprefix("s3://")
    bucket, separator, key = ref.partition("/")
    if not separator or not bucket or not key:
        raise ValueError("sourceAudioRef must be a bucket/key storage reference")
    return bucket, key


def _file_facts(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()
