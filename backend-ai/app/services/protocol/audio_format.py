"""Normalize TTS audio returned by proxies/vendors into a playable container.

OpenAI-compatible proxies (FreeLLMAPI, LiteLLM…) route one request to whichever
upstream model is available, so the same endpoint may answer MP3, WAV, OGG or
raw PCM (Gemini TTS: s16le @ 24 kHz mono, no header). Spring Boot sniffs the
container from the bytes and the media worker keeps that extension, so every
container passes through untouched; only headerless PCM must be wrapped as WAV.
"""
from __future__ import annotations

import re
import struct
from dataclasses import dataclass
from typing import Optional

DEFAULT_PCM_SAMPLE_RATE = 24000
DEFAULT_PCM_CHANNELS = 1
DEFAULT_PCM_BITS = 16

_PCM_MIME_TYPES = frozenset({"audio/pcm", "audio/l16", "audio/x-pcm", "audio/raw", "audio/s16le"})

# Declared content-type → canonical (mime, format) for containers the worker can decode.
_CONTAINER_MIME_TYPES: dict[str, tuple[str, str]] = {
    "audio/mpeg": ("audio/mpeg", "mp3"),
    "audio/mp3": ("audio/mpeg", "mp3"),
    "audio/wav": ("audio/wav", "wav"),
    "audio/wave": ("audio/wav", "wav"),
    "audio/x-wav": ("audio/wav", "wav"),
    "audio/vnd.wave": ("audio/wav", "wav"),
    "audio/ogg": ("audio/ogg", "ogg"),
    "audio/opus": ("audio/ogg", "ogg"),
    "audio/flac": ("audio/flac", "flac"),
    "audio/x-flac": ("audio/flac", "flac"),
    "audio/aac": ("audio/aac", "aac"),
    "audio/mp4": ("audio/mp4", "m4a"),
    "audio/x-m4a": ("audio/mp4", "m4a"),
    "audio/webm": ("audio/webm", "webm"),
}


@dataclass(frozen=True)
class NormalizedAudio:
    audio_bytes: bytes
    mime_type: str
    format: str
    sample_rate: Optional[int] = None


def pcm_s16le_to_wav(
    pcm: bytes,
    *,
    sample_rate: int = DEFAULT_PCM_SAMPLE_RATE,
    channels: int = DEFAULT_PCM_CHANNELS,
    bits_per_sample: int = DEFAULT_PCM_BITS,
) -> bytes:
    """Build a minimal PCM WAV container around raw s16le samples."""
    data = pcm
    frame_bytes = max(1, channels * (bits_per_sample // 8))
    # Pad odd trailing byte so s16 frames stay aligned.
    if len(data) % frame_bytes:
        data = data + (b"\x00" * (frame_bytes - (len(data) % frame_bytes)))
    data_size = len(data)
    byte_rate = sample_rate * channels * (bits_per_sample // 8)
    block_align = channels * (bits_per_sample // 8)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    return header + data


def sniff_container(data: bytes) -> Optional[tuple[str, str]]:
    """(mime, format) from magic bytes, or None when no known header is present."""
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav", "wav"
    if data[:4] == b"OggS":
        return "audio/ogg", "ogg"
    if data[:4] == b"fLaC":
        return "audio/flac", "flac"
    if data[:3] == b"ID3":
        return "audio/mpeg", "mp3"
    if len(data) >= 8 and data[4:8] == b"ftyp":
        return "audio/mp4", "m4a"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "audio/webm", "webm"
    if len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
        # ADTS AAC has layer bits 00; MPEG audio (MP3) uses non-zero layer bits.
        if (data[1] & 0x06) == 0:
            return "audio/aac", "aac"
        return "audio/mpeg", "mp3"
    return None


def normalize_tts_audio(data: bytes, content_type: Optional[str]) -> Optional[NormalizedAudio]:
    """Classify vendor audio; wrap headerless PCM as WAV.

    Returns None when the response is declared as an audio type we cannot decode
    (caller fails closed). The magic bytes win over the declared header, since
    proxies often label every body ``audio/mpeg`` or ``application/octet-stream``.
    Unknown bytes with a non-PCM header keep the historical MP3 assumption.
    """
    raw_type = (content_type or "").strip()
    mime = raw_type.split(";", 1)[0].strip().casefold()

    sniffed = sniff_container(data)
    if sniffed is not None:
        return NormalizedAudio(data, sniffed[0], sniffed[1])

    if mime in _PCM_MIME_TYPES:
        rate = _param_int(raw_type, "rate") or DEFAULT_PCM_SAMPLE_RATE
        channels = _param_int(raw_type, "channels") or DEFAULT_PCM_CHANNELS
        return NormalizedAudio(
            pcm_s16le_to_wav(data, sample_rate=rate, channels=channels),
            "audio/wav",
            "wav",
            sample_rate=rate,
        )

    if mime in _CONTAINER_MIME_TYPES:
        canonical_mime, fmt = _CONTAINER_MIME_TYPES[mime]
        return NormalizedAudio(data, canonical_mime, fmt)
    if mime.startswith("audio/"):
        return None
    return NormalizedAudio(data, "audio/mpeg", "mp3")


def _param_int(content_type: str, name: str) -> Optional[int]:
    match = re.search(rf"(?:^|;)\s*{name}\s*=\s*\"?(\d+)", content_type, flags=re.IGNORECASE)
    if not match:
        return None
    value = int(match.group(1))
    return value if value > 0 else None
