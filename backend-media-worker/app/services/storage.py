import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Optional, Tuple

from minio import Minio

from app.core.config import settings


class StorageService:
    def __init__(self) -> None:
        self.client = Minio(
            self._host(settings.minio_endpoint),
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=self._is_secure(settings.minio_endpoint),
        )
        self.bucket = settings.media_bucket

    @staticmethod
    def _host(endpoint: str) -> str:
        return endpoint.replace("http://", "").replace("https://", "").rstrip("/")

    @staticmethod
    def _is_secure(endpoint: str) -> bool:
        return endpoint.startswith("https://")

    def ensure_bucket(self) -> None:
        if not self.client.bucket_exists(self.bucket):
            self.client.make_bucket(self.bucket)

    def parse_ref(self, ref: str) -> Tuple[str, str]:
        """Parse a `bucket/object_key` reference."""
        parts = ref.split("/", 1)
        if len(parts) == 2 and parts[0]:
            return parts[0], parts[1]
        return self.bucket, ref

    def download(self, ref: str, dest_path: str) -> None:
        bucket, object_key = self.parse_ref(ref)
        self.client.fget_object(bucket, object_key, dest_path)

    def upload(self, source_path: str, object_key: Optional[str] = None) -> str:
        self.ensure_bucket()
        if object_key is None:
            object_key = f"worker/{uuid.uuid4()}"
        self.client.fput_object(self.bucket, object_key, source_path)
        return f"{self.bucket}/{object_key}"

    def presigned_url(self, ref: str, expiry: int = 900) -> str:
        bucket, object_key = self.parse_ref(ref)
        return self.client.presigned_get_object(bucket, object_key, expires=expiry)


_storage: Optional[StorageService] = None


def get_storage() -> StorageService:
    global _storage
    if _storage is None:
        _storage = StorageService()
    return _storage
