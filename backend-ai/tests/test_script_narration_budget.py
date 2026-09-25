"""Narration length budget for script summaries.

TTS reads the segment excerpts, and a narrated summary render is timed by the
measured narration — so the excerpts, not the footage, decide the output
length. Observed 2026-09-24: 297 s of footage but 3 144 characters of narration
read in 181 s (-40 %). The writer gets a character budget (requested seconds ×
voice chars/s, as the original narrative writer did). Whole-script "expand"
repairs kept shrinking the text (observed 2026-09-24: 5 558 -> 3 621 -> 2 531
chars for a 12 400 budget), so each fitted footage segment now gets its own
budget and only segments outside tolerance are rewritten, in batches.
"""
from __future__ import annotations

import json
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services import script_gateway


def _body(narration_cps: float | None) -> dict:
    body = {
        "correlation_id": "budget-test",
        "media_job_id": "job-budget",
        "transcript": [{"text": f"Sentence {i}.", "start_ms": i * 5000, "end_ms": (i + 1) * 5000} for i in range(60)],
        "requested_duration_seconds": 60,
        "target_lang": "vi",
        "provider": {"protocol": "dashscope_native", "base_url": "https://dashscope.example/api",
                     "api_key": "test-key", "model": "qwen3.8-max", "capabilities": ["TEXT"]},
    }
    if narration_cps is not None:
        body["narration_cps"] = narration_cps
    return body


def _output(chars_per_excerpt: int) -> str:
    first, second = "a" * chars_per_excerpt, "b" * chars_per_excerpt
    return json.dumps({
        "script_content": f"{first} {second}",
        "segments": [
            {"start_ms": 0, "end_ms": 30000, "script_excerpt": first},
            {"start_ms": 30000, "end_ms": 60000, "script_excerpt": second},
        ],
    })


def _narration(user_prompt: str, chars: int) -> SimpleNamespace:
    """Answer a narration batch with ``chars`` characters per requested segment."""
    ids = re.findall(r'<segment id="(\d+)"', user_prompt)
    return SimpleNamespace(text=json.dumps({"segments": [
        {"id": key, "narration": "n" * chars} for key in ids]}), usage=None)


def _post(body: dict, *outputs, narration=None):
    chat = AsyncMock(side_effect=[SimpleNamespace(text=o, usage=None) for o in outputs])
    fill = AsyncMock(side_effect=narration or [])
    with (
        patch.object(script_gateway.settings, "mock_mode", False),
        patch.object(script_gateway.settings, "script_output_repair_attempts", 2),
        patch("app.services.script_gateway.chat", chat),
        patch("app.services.summary.narration_fill.chat", fill),
        TestClient(app) as client,
    ):
        response = client.post("/media/summarize/script", json=body)
    assert response.status_code == 200
    return response.json(), chat, fill


def test_prompt_carries_the_narration_budget_from_the_voice_rate() -> None:
    payload, chat, fill = _post(_body(17.5), _output(525))  # 60 s × 17.5 = 1050 chars

    assert payload["status"] == "COMPLETED"
    prompt = chat.await_args_list[0].args[2]
    assert "about 1050 characters" in prompt
    assert chat.await_count == 1
    assert fill.await_count == 0  # already inside every segment budget


def test_default_rate_matches_the_original_writer_when_no_calibration_exists() -> None:
    payload, chat, _ = _post(_body(None), _output(420))  # 60 s × 14 = 840 chars

    assert payload["status"] == "COMPLETED"
    assert "about 840 characters" in chat.await_args_list[0].args[2]


def test_short_narration_is_rewritten_per_segment_to_its_budget() -> None:
    async def narrate(provider, system, user, **kwargs):
        assert 'target_chars="525"' in user and "<source>" in user
        return _narration(user, 520)

    payload, chat, fill = _post(_body(17.5), _output(200), narration=narrate)

    assert payload["status"] == "COMPLETED"
    assert chat.await_count == 1  # no whole-script repair round-trips
    assert fill.await_count == 1  # both short segments in one batch
    assert [len(s["script_excerpt"]) for s in payload["segments"]] == [520, 520]
    assert "NARRATION_LENGTH_RESIDUAL" not in payload["warnings"]
    for segment in payload["segments"]:
        assert segment["script_excerpt"] in payload["script_content"]


def test_rewrites_that_move_away_from_the_budget_are_discarded() -> None:
    async def narrate(provider, system, user, **kwargs):
        return _narration(user, 50)  # worse than the 200-char draft

    payload, _, fill = _post(_body(17.5), _output(200), narration=narrate)

    assert payload["status"] == "COMPLETED"
    assert fill.await_count == 3  # bounded rounds, then keep the best draft
    assert [len(s["script_excerpt"]) for s in payload["segments"]] == [200, 200]
    assert "NARRATION_LENGTH_RESIDUAL" in payload["warnings"]


def test_segments_the_model_skips_are_retried_next_round() -> None:
    calls = []

    async def narrate(provider, system, user, **kwargs):
        calls.append(user)
        ids = re.findall(r'<segment id="(\d+)"', user)
        keep = ids[:1] if len(calls) == 1 else ids
        return SimpleNamespace(text=json.dumps({"segments": [
            {"id": key, "narration": "n" * 525} for key in keep]}), usage=None)

    payload, _, fill = _post(_body(17.5), _output(200), narration=narrate)

    assert fill.await_count == 2
    assert 'id="2"' in calls[1] and 'id="1"' not in calls[1]
    assert [len(s["script_excerpt"]) for s in payload["segments"]] == [525, 525]
