"""Helpers shared by the cloud speech STT adapters (Azure, ElevenLabs).

Speech vendors that sell TTS and STT under one key return their transcripts in
vendor shapes (Azure phrases, ElevenLabs words); these helpers turn them into
the pipeline's sentence-level :class:`SttSegment` list.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from app.schemas.contract import SttSegment
from app.services.protocol.language_codes import normalize_language

# Primary subtag -> the locale a speech vendor expects when the job pins a
# source language (Azure needs a full locale; "vi" alone is rejected).
_DEFAULT_LOCALES = {
    "ar": "ar-SA",
    "de": "de-DE",
    "en": "en-US",
    "es": "es-ES",
    "fr": "fr-FR",
    "hi": "hi-IN",
    "id": "id-ID",
    "it": "it-IT",
    "ja": "ja-JP",
    "ko": "ko-KR",
    "ms": "ms-MY",
    "nl": "nl-NL",
    "pl": "pl-PL",
    "pt": "pt-BR",
    "ru": "ru-RU",
    "th": "th-TH",
    "tr": "tr-TR",
    "vi": "vi-VN",
    "zh": "zh-CN",
}

# ISO 639-3 codes some vendors report (ElevenLabs Scribe) -> the 2-letter
# primary subtag the rest of the pipeline compares.
_ISO639_3_TO_1 = {
    "ara": "ar", "cmn": "zh", "deu": "de", "eng": "en", "fra": "fr", "hin": "hi",
    "ind": "id", "ita": "it", "jpn": "ja", "khm": "km", "kor": "ko", "lao": "lo",
    "msa": "ms", "mya": "my", "nld": "nl", "pol": "pl", "por": "pt", "rus": "ru",
    "spa": "es", "tha": "th", "tur": "tr", "vie": "vi", "yue": "zh", "zho": "zh",
    "zsm": "ms",
}

_SENTENCE_END =(".", "?", "!", "。", "？", "！", "…")
# A pause this long between words starts a new cue even without punctuation.
_PAUSE_BREAK_MS = 900
# Longest cue: an unpunctuated run (Azure language-identification output, a
# monologue) is cut at its widest word gaps until every piece fits.
MAX_SEGMENT_MS = 7_000


def is_auto_language(source_lang: Optional[str]) -> bool:
    return source_lang is None or source_lang.strip().lower() in ("", "auto")


def locale_for(source_lang: Optional[str]) -> Optional[str]:
    """Full locale for a pinned source language; ``None`` for auto/unknown."""
    if source_lang is None or is_auto_language(source_lang):
        return None
    raw = source_lang.strip().replace("_", "-")
    parts = raw.split("-")
    if len(parts) >= 2 and len(parts[1]) == 2:
        return f"{parts[0].lower()}-{parts[1].upper()}"
    primary = normalize_language(raw)
    return _DEFAULT_LOCALES.get(primary) if primary else None


def detected_language(raw: Optional[str]) -> Optional[str]:
    """Vendor-reported language (``vi``, ``vi-VN``, ``vie``) -> 2-letter subtag."""
    primary = normalize_language(raw)
    if primary is None:
        return None
    return _ISO639_3_TO_1.get(primary, primary)


@dataclass(frozen=True)
class TimedWord:
    text: str
    start_ms: int
    end_ms: int


def segments_from_words(
    words: Iterable[TimedWord], *, joiner: str = " ", max_ms: int = MAX_SEGMENT_MS
) -> list[SttSegment]:
    """Group timed words into sentence-level segments.

    A segment closes on sentence punctuation or a long pause; a group still
    longer than ``max_ms`` is cut at its widest word gaps (the likeliest
    sentence boundaries when the vendor sends no punctuation). Words without
    text or with inverted timing are skipped.
    """
    groups: list[list[TimedWord]] = []
    current: list[TimedWord] = []
    for word in words:
        text = (word.text or "").strip()
        if not text or word.end_ms < word.start_ms:
            continue
        if current and word.start_ms - current[-1].end_ms >= _PAUSE_BREAK_MS:
            groups.append(current)
            current = []
        current.append(TimedWord(text=text, start_ms=word.start_ms, end_ms=word.end_ms))
        if text.endswith(_SENTENCE_END):
            groups.append(current)
            current = []
    if current:
        groups.append(current)

    segments: list[SttSegment] = []
    for group in groups:
        for piece in split_at_widest_gaps(group, max_ms):
            text = joiner.join(w.text for w in piece).strip()
            if text:
                segments.append(
                    SttSegment(text=text, start_ms=piece[0].start_ms, end_ms=max(piece[-1].end_ms, piece[0].start_ms + 1))
                )
    return segments


def split_at_widest_gaps(words: list[TimedWord], max_ms: int = MAX_SEGMENT_MS) -> list[list[TimedWord]]:
    """Split ``words`` at the widest inter-word gap until each piece spans at most ``max_ms``."""
    if len(words) < 2 or words[-1].end_ms - words[0].start_ms <= max_ms:
        return [words]
    cut = max(range(1, len(words)), key=lambda i: words[i].start_ms - words[i - 1].end_ms)
    return split_at_widest_gaps(words[:cut], max_ms) + split_at_widest_gaps(words[cut:], max_ms)
