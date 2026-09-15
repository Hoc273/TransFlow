from __future__ import annotations

import hashlib
from pathlib import Path

from app.services.separation.storage import InMemorySeparationStorage


def test_in_memory_storage_downloads_and_uploads_with_integrity_facts(tmp_path: Path) -> None:
    storage = InMemorySeparationStorage()
    storage.objects["input/audio.wav"] = b"source-audio"
    downloaded = tmp_path / "source.wav"

    storage.download("input/audio.wav", downloaded)
    stored = storage.upload(downloaded, "separation/run-1/vocal", content_type="audio/wav")

    assert stored.object_ref == "separation/run-1/vocal"
    assert stored.file_size_bytes == len(b"source-audio")
    assert stored.checksum_sha256 == hashlib.sha256(b"source-audio").hexdigest()
    assert storage.objects[stored.object_ref] == b"source-audio"
