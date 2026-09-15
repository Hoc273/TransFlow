"""Helpers to coerce LLM text into the JSON object our contract requires.

Models sometimes wrap JSON in prose or ```json fences despite instructions.
`parse_json_object` strips fences and extracts the first balanced {...} block.
If the model emitted reasoning prose that contains brace characters before
the actual JSON payload, we walk every candidate balanced span and return
the first one that parses as a JSON object — preferring the one that contains
a list value (the schema for translate/qa/summarize is always a dict whose
top-level value is a list or contains a list).
"""
from __future__ import annotations

import json
from typing import Any


def parse_json_object(text: str) -> dict[str, Any]:
    """Best-effort extraction of a single JSON object from model output.

    Raises ValueError if no valid JSON object can be recovered.
    """
    cleaned = _strip_code_fence(text.strip())
    try:
        obj = json.loads(cleaned)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass

    # Walk every balanced candidate and return the first that parses.
    for span in _all_balanced_objects(cleaned):
        try:
            obj = json.loads(span)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        # Prefer dicts that contain at least one list value (matches our
        # contract: {"proposals": [...]}, {"issues": [...]},
        # {"translation": "...", "applied_glossary": [...]}). This avoids
        # matching tiny accidental dicts from prose (e.g. {"note": "..."}).
        if any(isinstance(v, list) for v in obj.values()):
            return obj

    # Final fallback: return the first valid JSON object regardless of shape.
    for span in _all_balanced_objects(cleaned):
        try:
            obj = json.loads(span)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            return obj
    raise ValueError("Model output did not contain a JSON object")


def _strip_code_fence(text: str) -> str:
    if not text.startswith("```"):
        return text
    # Drop the opening fence line (``` or ```json) and the trailing fence.
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _all_balanced_objects(text: str) -> list[str]:
    """Yield every balanced ``{...}`` span starting at each ``{`` in ``text``.

    Returns the spans in left-to-right order, each independently balanced.
    Strings are tracked correctly so embedded braces inside quoted values do
    not confuse the depth counter.
    """
    spans: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        depth = 0
        in_str = False
        escape = False
        start = i
        end = -1
        for j in range(i, n):
            ch = text[j]
            if in_str:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end = j
                        break
        if end > start:
            spans.append(text[start : end + 1])
            i = end + 1
        else:
            i += 1
    return spans


def _first_json_object(text: str) -> str | None:
    spans = _all_balanced_objects(text)
    return spans[0] if spans else None
