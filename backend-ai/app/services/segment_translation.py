"""One-to-one translation of timed subtitle lines for ``/ai/translate``.

Translating a joined transcript and re-splitting it afterwards cannot keep
lines aligned (CJK text has no spaces to split on, and models move words
across sentence borders). Lines are therefore sent in numbered batches and
must come back with exactly one translation per id. Whatever a model drops
is retried as a smaller batch and finally one line at a time, so the result
never depends on how well a particular model follows the batch format.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.api.structured import parse_json_object
from app.core.config import settings
from app.core.prompts import build_segment_translate_prompt, build_translate_prompt
from app.schemas.contract import (
    TranslateRequest,
    TranslateResponse,
    TranslateSegmentOut,
    Usage,
)
from app.services import llm_gateway
from app.services.provider_errors import ProviderErrorCode, ProviderException

_log = logging.getLogger("transflow.ai.segment_translation")

MAX_BATCH_LINES = 30
MAX_BATCH_CHARS = 2500
CONTEXT_LINES = 3


def _batches(lines: list[tuple[int, str]]) -> list[list[tuple[int, str]]]:
    batches: list[list[tuple[int, str]]] = []
    current: list[tuple[int, str]] = []
    chars = 0
    for line in lines:
        if current and (len(current) >= MAX_BATCH_LINES or chars + len(line[1]) > MAX_BATCH_CHARS):
            batches.append(current)
            current, chars = [], 0
        current.append(line)
        chars += len(line[1])
    if current:
        batches.append(current)
    return batches


def _add_usage(total: Usage | None, usage: Usage | None) -> Usage | None:
    if usage is None:
        return total
    if total is None:
        return usage
    return Usage(
        input_tokens=(total.input_tokens or 0) + (usage.input_tokens or 0),
        output_tokens=(total.output_tokens or 0) + (usage.output_tokens or 0),
        provider=total.provider or usage.provider,
        model=total.model or usage.model,
    )


def _entries(payload: Any) -> list[Any]:
    """Accept the shapes models actually return for a keyed list."""
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("translations", "segments", "lines", "items", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            return [{"id": k, "translation": v} for k, v in value.items()]
    # {"1": "...", "2": "..."}
    if payload and all(isinstance(v, str) for v in payload.values()):
        return [{"id": k, "translation": v} for k, v in payload.items()]
    return []


def _parse_batch(text: str, keys: set[str]) -> dict[str, str]:
    try:
        payload = parse_json_object(text)
    except ValueError:
        # parse_json_object only returns objects; a bare list is still usable.
        try:
            payload = json.loads((text or "").strip().strip("`").removeprefix("json").strip())
        except ValueError:
            return {}
    found: dict[str, str] = {}
    for item in _entries(payload):
        if not isinstance(item, dict):
            continue
        key = str(item.get("id", item.get("line_id", ""))).strip()
        value = item.get("translation", item.get("text", item.get("target_text")))
        if key in keys and isinstance(value, str) and value.strip():
            found[key] = value.strip()
    return found


async def _translate_batch(req: TranslateRequest, batch: list[tuple[int, str]],
                           previous: list[str]) -> tuple[dict[int, str], Usage | None]:
    lines = [(str(n + 1), text) for n, (_, text) in enumerate(batch)]
    system, user = build_segment_translate_prompt(
        req.source_lang, req.target_lang, lines, req.glossary, previous,
    )
    result = await llm_gateway.chat(
        req.provider,
        system,
        user,
        max_tokens=settings.translate_max_tokens,
        response_format={"type": "json_object"},
        extra_body=llm_gateway.text_reasoning_extra(
            req.provider, disabled=settings.disable_thinking_for_translate),
    )
    found = _parse_batch(result.text or "", {key for key, _ in lines})
    return {batch[int(key) - 1][0]: value for key, value in found.items()}, result.usage


async def _translate_single(req: TranslateRequest, text: str) -> tuple[str | None, Usage | None]:
    system, user = build_translate_prompt(req.source_lang, req.target_lang, text, req.glossary, req.context)
    result = await llm_gateway.chat(
        req.provider,
        system,
        user,
        max_tokens=settings.translate_max_tokens,
        response_format={"type": "json_object"},
        extra_body=llm_gateway.text_reasoning_extra(
            req.provider, disabled=settings.disable_thinking_for_translate),
    )
    try:
        translation = parse_json_object(result.text).get("translation")
    except ValueError:
        translation = None
    if not isinstance(translation, str) or not translation.strip():
        # Plain-text answers are common for one short line.
        raw = (result.text or "").strip()
        translation = raw if raw and not raw.startswith("{") else None
    return (translation.strip() if translation else None), result.usage


async def translate_segments(req: TranslateRequest) -> TranslateResponse:
    """Translate ``req.segments`` one-to-one; raises ProviderException on provider failure."""
    segments = req.segments or []
    translations: dict[int, str] = {}
    usage: Usage | None = None
    lines = [(index, segment.text.strip()) for index, segment in enumerate(segments)]
    for index, text in lines:
        if not text:
            translations[index] = ""
    pending = [(index, text) for index, text in lines if text]

    if settings.mock_mode or not settings.key_is_usable(req.provider.api_key):
        translations.update({index: text for index, text in pending})
        pending = []

    # Round 1: full batches. Round 2: only the lines a model skipped, in
    # smaller batches. Round 3: one line per call (plain translate contract).
    for round_index in range(2):
        if not pending:
            break
        missing: list[tuple[int, str]] = []
        for batch in _batches(pending) if round_index == 0 else [
            pending[i:i + 5] for i in range(0, len(pending), 5)
        ]:
            first = batch[0][0]
            previous = [text for _, text in lines[max(0, first - CONTEXT_LINES):first] if text]
            found, batch_usage = await _translate_batch(req, batch, previous)
            usage = _add_usage(usage, batch_usage)
            translations.update(found)
            missing.extend(line for line in batch if line[0] not in found)
        if missing:
            _log.warning(
                "segment translation round=%d request_id=%s model=%s missing=%d/%d",
                round_index + 1, req.request_id, req.provider.model, len(missing), len(lines),
            )
        pending = missing

    for index, text in pending:
        translation, single_usage = await _translate_single(req, text)
        usage = _add_usage(usage, single_usage)
        if not translation:
            raise ProviderException(
                ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
                f"Model returned no translation for subtitle line {index + 1}",
                provider=req.provider.base_url,
                protocol=req.provider.protocol,
                capability="TEXT",
                model=req.provider.model,
            )
        translations[index] = translation

    out = [
        TranslateSegmentOut(id=segment.id, translation=translations.get(index, ""))
        for index, segment in enumerate(segments)
    ]
    return TranslateResponse(
        request_id=req.request_id,
        status="COMPLETED",
        translation="\n".join(item.translation for item in out if item.translation),
        segments=out,
        usage=usage,
    )
