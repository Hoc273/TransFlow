"""Length-budgeted narration for script-first summaries.

The rendered summary lasts as long as its measured narration, so the
narration must fill the requested duration. One LLM call cannot write a
10k+ character script to a length target: models return a fraction of it
and "expand" repairs of the whole script make it shorter still. Following
the original narrative writer, each already-fitted footage segment gets its
own character budget (seconds x voice chars/s), segments are written in small
batches, and only segments still outside tolerance are rewritten. A rewrite
is kept only when it lands closer to its budget, so rounds never regress.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.api.structured import parse_json_object
from app.core.config import settings
from app.core.prompts import build_script_narration_prompt
from app.schemas.contract import Usage
from app.services.llm_gateway import chat, text_reasoning_extra
from app.services.provider_errors import ProviderException

_log = logging.getLogger("transflow.ai.script.narration")

BATCH_SIZE = 8
MAX_ROUNDS = 3  # initial rewrite of short segments + 2 repair rounds, as in the origin writer
SEGMENT_TOLERANCE = 0.15
MIN_SEGMENT_CHARS = 12
MAX_CONSECUTIVE_FAILURES = 2  # back-to-back failed batches mean the provider is down, not flaky
_UNSPACED_LANGS = ("zh", "ja", "ko", "th", "lo", "my", "km")


@dataclass
class NarrationSlot:
    start_ms: int
    end_ms: int
    text: str
    source: list[str]

    def target(self, cps: float) -> int:
        return max(MIN_SEGMENT_CHARS, round((self.end_ms - self.start_ms) / 1000 * cps))

    def miss(self, cps: float, text: str | None = None) -> float:
        target = self.target(cps)
        return abs(len((self.text if text is None else text).strip()) - target) / target


def join_narration(texts: list[str], target_lang: str) -> str:
    separator = "" if (target_lang or "").lower().split("-")[0] in _UNSPACED_LANGS else " "
    return separator.join(text.strip() for text in texts if text.strip())


def _add_usage(total: Usage | None, usage) -> Usage | None:
    if usage is None:
        return total
    if total is None:
        return usage
    return Usage(
        input_tokens=(total.input_tokens or 0) + (getattr(usage, "input_tokens", 0) or 0),
        output_tokens=(total.output_tokens or 0) + (getattr(usage, "output_tokens", 0) or 0),
        provider=total.provider or getattr(usage, "provider", None),
        model=total.model or getattr(usage, "model", None),
    )


def _parse(text: str, keys: set[str]) -> dict[str, str]:
    try:
        payload = parse_json_object(text)
    except ValueError:
        try:
            payload = json.loads((text or "").strip())
        except ValueError:
            return {}
    items = payload
    if isinstance(payload, dict):
        items = next((payload[k] for k in ("segments", "narrations", "items") if isinstance(payload.get(k), list)),
                     None)
        if items is None:
            items = [{"id": k, "narration": v} for k, v in payload.items() if isinstance(v, str)]
    found: dict[str, str] = {}
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("id", "")).strip()
        value = item.get("narration", item.get("text", item.get("script_excerpt")))
        if key in keys and isinstance(value, str) and value.strip():
            found[key] = " ".join(value.split())
    return found


async def fill_narration(
    slots: list[NarrationSlot],
    *,
    provider,
    target_lang: str,
    cps: float,
    visual_context: object = None,
    correlation_id: str = "",
) -> Usage | None:
    """Rewrite ``slots[i].text`` in place until each is near its budget; returns the extra usage."""
    usage: Usage | None = None
    last_error: ProviderException | None = None
    consecutive_failures = 0
    for round_index in range(MAX_ROUNDS):
        pending = [i for i, slot in enumerate(slots) if slot.miss(cps) > SEGMENT_TOLERANCE]
        if not pending:
            break
        _log.info(
            "Narration fill correlation_id=%s round=%d/%d segments=%d/%d chars=%d target=%d",
            correlation_id, round_index + 1, MAX_ROUNDS, len(pending), len(slots),
            sum(len(s.text) for s in slots), sum(s.target(cps) for s in slots),
        )
        for offset in range(0, len(pending), BATCH_SIZE):
            batch = pending[offset:offset + BATCH_SIZE]
            items = []
            for i in batch:
                target = slots[i].target(cps)
                items.append({
                    "id": str(i + 1),
                    "seconds": (slots[i].end_ms - slots[i].start_ms) / 1000,
                    "target_chars": target,
                    "min_chars": round(target * (1 - SEGMENT_TOLERANCE / 2)),
                    "max_chars": round(target * (1 + SEGMENT_TOLERANCE / 2)),
                    "source": slots[i].source,
                    "draft": slots[i].text,
                })
            previous = slots[batch[0] - 1].text if batch[0] > 0 else None
            system, user = build_script_narration_prompt(
                target_lang, items, previous_narration=previous, visual_context=visual_context,
            )
            try:
                result = await chat(
                    provider,
                    system,
                    user,
                    max_tokens=settings.summarize_max_tokens,
                    response_format={"type": "json_object"},
                    extra_body=text_reasoning_extra(provider, disabled=settings.disable_thinking_for_summarize),
                )
            except ProviderException as exc:
                # One transient batch failure must not abort the other batches: its slots stay
                # pending and are retried next round. A dead provider still stops early.
                last_error = exc
                consecutive_failures += 1
                _log.warning(
                    "Narration batch failed correlation_id=%s round=%d segments=%s errorCode=%s retryable=%s",
                    correlation_id, round_index + 1, [i + 1 for i in batch], exc.code.value, exc.retryable,
                )
                if not exc.retryable or consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    raise
                continue
            consecutive_failures = 0
            usage = _add_usage(usage, result.usage)
            for key, text in _parse(result.text or "", {item["id"] for item in items}).items():
                slot = slots[int(key) - 1]
                if slot.miss(cps, text) < slot.miss(cps):
                    slot.text = text
    if last_error is not None and any(not slot.text.strip() for slot in slots):
        # Slots are updated in place, so the caller keeps every batch that succeeded.
        raise last_error
    return usage
