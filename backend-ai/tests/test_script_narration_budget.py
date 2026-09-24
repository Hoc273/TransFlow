"""Narration length budget for script summaries.

TTS reads the segment excerpts, and a narrated summary render is timed by the
measured narration — so the excerpts, not the footage, decide the output
length. Observed 2026-09-24: 297 s of footage but 3 144 characters of narration
read in 181 s (-40 %). The writer gets a character budget (requested seconds ×
voice chars/s, as the original narrative writer did) and is asked to repair a
draft outside ±10 %.
"""
from __future__ import annotations

import json
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


def _post(body: dict, *outputs: str):
    chat = AsyncMock(side_effect=[SimpleNamespace(text=o, usage=None) for o in outputs])
    with (
        patch.object(script_gateway.settings, "mock_mode", False),
        patch.object(script_gateway.settings, "script_output_repair_attempts", 2),
        patch("app.services.script_gateway.chat", chat),
        TestClient(app) as client,
    ):
        response = client.post("/media/summarize/script", json=body)
    assert response.status_code == 200
    return response.json(), chat


def test_prompt_carries_the_narration_budget_from_the_voice_rate() -> None:
    payload, chat = _post(_body(17.5), _output(525))  # 60 s × 17.5 = 1050 chars

    assert payload["status"] == "COMPLETED"
    prompt = chat.await_args_list[0].args[2]
    assert "about 1050 characters" in prompt
    assert chat.await_count == 1


def test_default_rate_matches_the_original_writer_when_no_calibration_exists() -> None:
    payload, chat = _post(_body(None), _output(420))  # 60 s × 14 = 840 chars

    assert payload["status"] == "COMPLETED"
    assert "about 840 characters" in chat.await_args_list[0].args[2]


def test_short_narration_is_repaired_with_the_measured_gap() -> None:
    payload, chat = _post(_body(17.5), _output(200), _output(520))

    assert payload["status"] == "COMPLETED"
    assert chat.await_count == 2
    repair = chat.await_args_list[1].args[2]
    assert "400 characters" in repair and "about 1050 characters" in repair  # measured vs target
    assert "NARRATION_LENGTH_RESIDUAL" not in payload["warnings"]
    assert len(payload["segments"][0]["script_excerpt"]) == 520


def test_residual_length_miss_keeps_the_closest_draft_instead_of_failing() -> None:
    # Measured TTS stays authoritative and render tempo absorbs a small residual,
    # so a writer that cannot hit ±10 % must not fail the job.
    payload, chat = _post(_body(17.5), _output(200), _output(400), _output(300))

    assert payload["status"] == "COMPLETED"
    assert chat.await_count == 3
    assert "NARRATION_LENGTH_RESIDUAL" in payload["warnings"]
    assert len(payload["segments"][0]["script_excerpt"]) == 400
