"""Sentence-level splitter for generative recap captions.

TASK: Generative Summary Sentence-Level SRT (Option A).

Pure, deterministic, side-effect free utility:
- input: generated narration/script (any target language; `vi` is the
  canonical golden language for this milestone);
- output: ordered sentences, punctuation preserved, whitespace trimmed;
- split primarily on `.`, `!`, `?`, `…`;
- never split inside a token/word;
- no semantic rewriting, no translation, no deduplication.

Deduplication / narrative-contract enforcement lives in the narrative
validation layer (`narrative_summarize_gateway`), NOT here. The media
worker keeps a local copy of the same regex so it stays DB-free and
dependency-free.
"""
from __future__ import annotations

import re

# Terminators that end a recap sentence. Includes the CJK/VI ellipsis char.
_TERMINATORS = ".!?…"

# Common abbreviations that must NOT trigger a split (case-insensitive,
# language-aware enough for vi/en golden tests without hard-coding vi).
_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "st", "tp", "ts", "ths", "vd", "vs",
    "anh", "chi", "em", "ong", "ba", "co", "chu", "bk",
}

# Sentence boundary: a terminator run (optionally followed by closing
# quotes/brackets), then whitespace/newline (or end of string), where the
# next significant char starts a new sentence (uppercase incl. Vietnamese,
# digit, or opening quote/bracket) — or end of string.
_BOUNDARY_RE = re.compile(
    r"(?:(?P<term_cjk>[。！？]+[\"'”’)\]}]*)(?P<sep_cjk>\s*|$)(?=(?P<next_cjk>[\"'“‘(\[]?[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afA-Za-z0-9]|$)))|"
    r"(?:(?P<term_latin>[.!?…]+[\"'”’)\]}]*)(?P<sep_latin>\s+|$)(?=(?P<next_latin>[\"'“‘(\[]?[A-ZÀ-Ỹ0-9]|$)))"
)


def _is_abbreviation(text: str, term_start: int) -> bool:
    """Return True when the terminator belongs to a known abbreviation."""
    m = re.search(r"([A-Za-zÀ-ỹ]+)$", text[:term_start])
    if not m:
        return False
    return m.group(1).lower() in _ABBREVIATIONS


def _is_decimal_point(text: str, term_start: int, term_end: int) -> bool:
    """Guard against splitting decimal numbers like 3.5 or 10.00."""
    if term_end - term_start != 1 or text[term_start] != ".":
        return False
    before = text[term_start - 1] if term_start > 0 else ""
    after = text[term_end] if term_end < len(text) else ""
    return before.isdigit() and after.isdigit()


def split_sentences(text: str | None) -> list[str]:
    """Split narration into ordered sentences.

    Deterministic and side-effect free. Empty/blank input yields [].
    """
    if text is None:
        return []
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    sentences: list[str] = []
    start = 0
    for m in _BOUNDARY_RE.finditer(normalized):
        is_cjk = bool(m.group("term_cjk"))
        term_group = "term_cjk" if is_cjk else "term_latin"
        sep_group = "sep_cjk" if is_cjk else "sep_latin"
        term_start = m.start(term_group)
        term_end = m.start(sep_group)
        if not is_cjk and _is_decimal_point(normalized, term_start, term_end):
            continue
        if not is_cjk and _is_abbreviation(normalized, term_start):
            continue
        end = m.end(term_group)
        sentence = normalized[start:end].strip()
        if sentence:
            sentences.append(sentence)
        start = m.end()
        # Skip remaining separator whitespace already consumed.
    tail = normalized[start:].strip()
    if tail:
        sentences.append(tail)
    # If no boundary ever matched but newlines separate lines, fall back to
    # newline split so line-broken narration still yields cues.
    if len(sentences) == 1 and "\n" in sentences[0]:
        parts = [p.strip() for p in sentences[0].split("\n") if p.strip()]
        if len(parts) > 1:
            return parts
    return sentences
