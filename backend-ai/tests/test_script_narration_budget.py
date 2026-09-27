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


def _on_budget(user_prompt: str, only: list[str] | None = None) -> SimpleNamespace:
    """Answer each requested segment with exactly its target_chars."""
    items = re.findall(r'<segment id="(\d+)"[^>]*target_chars="(\d+)"', user_prompt)
    return SimpleNamespace(text=json.dumps({"segments": [
        {"id": key, "narration": "n" * int(target)} for key, target in items
        if only is None or key in only]}), usage=None)


def _budget(segment: dict, cps: float) -> int:
    return max(12, round((segment["end_ms"] - segment["start_ms"]) / 1000 * cps))


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
    async def narrate(provider, system, user, **kwargs):
        return _on_budget(user)

    payload, chat, _ = _post(_body(17.5), _output(525), narration=narrate)  # 60 s × 17.5 = 1050 chars

    assert payload["status"] == "COMPLETED"
    prompt = chat.await_args_list[0].args[2]
    assert "about 1050 characters" in prompt
    assert chat.await_count == 1
    total = sum(len(s["script_excerpt"]) for s in payload["segments"])
    assert abs(total - 1050) <= 105
    assert "NARRATION_LENGTH_RESIDUAL" not in payload["warnings"]


def test_default_rate_matches_the_original_writer_when_no_calibration_exists() -> None:
    async def narrate(provider, system, user, **kwargs):
        return _on_budget(user)

    payload, chat, _ = _post(_body(None), _output(420), narration=narrate)  # 60 s × 14 = 840 chars

    assert payload["status"] == "COMPLETED"
    assert "about 840 characters" in chat.await_args_list[0].args[2]


def test_short_narration_is_rewritten_per_segment_to_its_budget() -> None:
    async def narrate(provider, system, user, **kwargs):
        assert "target_chars=" in user and "<source>" in user
        return _on_budget(user)

    payload, chat, fill = _post(_body(17.5), _output(200), narration=narrate)

    assert payload["status"] == "COMPLETED"
    assert chat.await_count == 1  # no whole-script repair round-trips
    assert fill.await_count == -(-len(payload["segments"]) // 8)  # one batched round
    assert all(len(s["script_excerpt"]) == _budget(s, 17.5) for s in payload["segments"])
    assert "NARRATION_LENGTH_RESIDUAL" not in payload["warnings"]
    for segment in payload["segments"]:
        assert segment["script_excerpt"] in payload["script_content"]


def test_rewrites_that_move_away_from_the_budget_are_discarded() -> None:
    async def narrate(provider, system, user, **kwargs):
        return _narration(user, 5000)  # far above every budget

    payload, _, fill = _post(_body(17.5), _output(200), narration=narrate)

    assert payload["status"] == "COMPLETED"
    assert fill.await_count == 3 * 2  # 3 bounded rounds x 2 batches of the 11 coverage sections
    excerpts = [s["script_excerpt"] for s in payload["segments"]]
    # The model's drafts are closer to budget than the runaway rewrites, so they survive;
    # sections that never got usable narration are dropped rather than rendered silent.
    assert excerpts == ["a" * 200, "b" * 200]
    assert "NARRATION_LENGTH_RESIDUAL" in payload["warnings"]
    assert "SECTIONS_WITHOUT_NARRATION_DROPPED" in payload["warnings"]


def test_segments_the_model_skips_are_retried_next_round() -> None:
    calls = []

    async def narrate(provider, system, user, **kwargs):
        calls.append(user)
        ids = re.findall(r'<segment id="(\d+)"', user)
        return _on_budget(user, only=ids[:1] if len(calls) == 1 else None)

    payload, _, fill = _post(_body(17.5), _output(200), narration=narrate)

    first_round = -(-len(payload["segments"]) // 8)
    assert fill.await_count == first_round + 1
    retry = calls[first_round]
    assert 'id="2"' in retry and 'id="1"' not in retry
    assert all(len(s["script_excerpt"]) == _budget(s, 17.5) for s in payload["segments"])


def test_sections_cover_the_whole_source_even_when_the_model_clusters_at_the_start() -> None:
    async def narrate(provider, system, user, **kwargs):
        return _on_budget(user)

    payload, _, _ = _post(_body(17.5), _output(525), narration=narrate)  # model: only 0-60 s of 300 s

    segments = payload["segments"]
    assert len(segments) >= 8
    assert segments[0]["start_ms"] < 45_000
    assert segments[-1]["end_ms"] > 255_000
    # No gap between consecutive sections is wider than two coverage windows.
    assert all(b["start_ms"] - a["end_ms"] < 90_000 for a, b in zip(segments, segments[1:]))


def _gateway_502():
    from app.services.provider_errors import ProviderErrorCode, ProviderException

    return ProviderException(ProviderErrorCode.PROVIDER_INTERNAL_ERROR, "Provider returned an internal error")


def test_a_transient_batch_failure_does_not_drop_the_other_sections() -> None:
    # Observed 2026-09-26: batch 2 of 7 hit a router 502, the whole fill aborted and every
    # section without a draft was dropped -> 760 of 4 863 chars, a 1 min render for 5 min.
    calls = []

    async def narrate(provider, system, user, **kwargs):
        calls.append(user)
        if len(calls) == 2:
            raise _gateway_502()
        return _on_budget(user)

    body = _body(17.5)
    body["transcript"] = [{"text": f"Sentence {i}.", "start_ms": i * 5000, "end_ms": (i + 1) * 5000}
                          for i in range(120)]
    body["requested_duration_seconds"] = 300
    payload, _, _ = _post(body, _output(200), narration=narrate)

    assert payload["status"] == "COMPLETED"
    assert "SECTIONS_WITHOUT_NARRATION_DROPPED" not in payload["warnings"]
    assert "NARRATION_FILL_DEGRADED" not in payload["warnings"]
    total = sum(len(s["script_excerpt"]) for s in payload["segments"])
    assert abs(total - 300 * 17.5) <= 300 * 17.5 * 0.10


def test_a_fill_that_keeps_failing_returns_a_retryable_failure_not_a_short_proposal() -> None:
    async def narrate(provider, system, user, **kwargs):
        raise _gateway_502()

    payload, _, fill = _post(_body(17.5), _output(100), narration=narrate)

    assert payload["status"] == "FAILED"
    assert payload["error_detail"]["retryable"] is True
    assert fill.await_count == 2  # stops after back-to-back failures instead of every batch x round
