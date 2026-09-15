"""BCP-47 language normalization shared by voice-discovery adapters.

Voice compatibility everywhere downstream (Spring ``MediaLanguageValidator``,
frontend ``voiceMatchesTargetLang``) compares the 2-char primary subtag, so
discovery must persist normalized codes:

    vi-VN -> vi    en-US -> en    en-GB -> en

Anything that is not an ISO-639-style primary subtag (2-3 letters) normalizes
to ``None`` — callers treat it as unknown. Unknown is NEVER auto-compatible
with a target language.
"""
from __future__ import annotations

import re

_PRIMARY_RE = re.compile(r"^[a-z]{2,3}$")


def normalize_language(raw: str | None) -> str | None:
    """Return the lowercase primary language subtag, or None when unusable."""
    if raw is None:
        return None
    primary = str(raw).strip().lower().replace("_", "-").split("-", 1)[0]
    if not _PRIMARY_RE.match(primary):
        return None
    return primary


def normalize_languages(values) -> list[str]:
    """Ordered, de-duplicated list of normalized codes; drops unknowns."""
    result: list[str] = []
    for value in values or []:
        normalized = normalize_language(value)
        if normalized and normalized not in result:
            result.append(normalized)
    return result
