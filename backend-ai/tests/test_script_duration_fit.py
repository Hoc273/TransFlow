"""The gateway, not the model, owns the requested duration window.

Small/flash models routinely under- or over-shoot the footage arithmetic, so
``script_gateway`` grounds the model's selection in the transcript and fits
it into the window deterministically (the role the original allocator played).
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services import script_gateway


def _transcript(count: int = 60, step_ms: int = 5000) -> list[dict]:
    return [
        {"text": f"Sentence {i}.", "start_ms": i * step_ms, "end_ms": (i + 1) * step_ms}
        for i in range(count)
    ]


def _body(requested_seconds: int, transcript: list[dict] | None = None) -> dict:
    return {
        "correlation_id": "fit-test",
        "media_job_id": "job-fit-test",
        "transcript": _transcript() if transcript is None else transcript,
        "requested_duration_seconds": requested_seconds,
        "target_lang": "vi",
        "provider": {
            "protocol": "dashscope_native",
            "base_url": "https://dashscope.example/api",
            "api_key": "test-key",
            "model": "qwen3.7-flash",
            "capabilities": ["TEXT"],
        },
    }


def _post(body: dict, *outputs: str):
    chat_mock = AsyncMock(side_effect=[SimpleNamespace(text=o, usage=None) for o in outputs])
    with (
        patch.object(script_gateway.settings, "mock_mode", False),
        # Footage fitting only: placeholder excerpts are far below the narration
        # budget, so disable the narration repair round-trips here.
        patch.object(script_gateway.settings, "script_output_repair_attempts", 0),
        patch("app.services.script_gateway.chat", chat_mock),
        # The narration writer is covered by test_script_narration_budget; keep drafts as-is.
        patch("app.services.summary.narration_fill.chat",
              AsyncMock(return_value=SimpleNamespace(text="{}", usage=None))),
        TestClient(app) as client,
    ):
        response = client.post("/media/summarize/script", json=body)
    assert response.status_code == 200
    return response.json(), chat_mock


def _total(segments: list[dict]) -> int:
    return sum(s["end_ms"] - s["start_ms"] for s in segments)


def _assert_valid(payload: dict, requested_ms: int) -> None:
    assert payload["status"] == "COMPLETED", payload
    segments = payload["segments"]
    assert int(requested_ms * 0.8) <= _total(segments) <= int(requested_ms * 1.2)
    previous_end = -1
    for segment in segments:
        assert segment["end_ms"] > segment["start_ms"]
        assert segment["start_ms"] >= previous_end, "segments must not overlap"
        assert segment["script_excerpt"] in payload["script_content"]
        previous_end = segment["end_ms"]


def test_underfilled_selection_is_extended_to_the_requested_window() -> None:
    output = json.dumps({
        "script_content": "Mở đầu. Kết thúc.",
        "segments": [
            {"start_ms": 10000, "end_ms": 20000, "script_excerpt": "Mở đầu.", "source_sentence_refs": ["2", "3"]},
            {"start_ms": 200000, "end_ms": 210000, "script_excerpt": "Kết thúc.", "source_sentence_refs": ["40"]},
        ],
    })
    payload, chat_mock = _post(_body(120), output)

    _assert_valid(payload, 120_000)
    assert chat_mock.await_count == 1
    assert "DURATION_NORMALIZED" in payload["warnings"]


def test_overfilled_selection_is_trimmed_to_the_requested_window() -> None:
    output = json.dumps({
        "script_content": "Toàn bộ nội dung.",
        "segments": [{"start_ms": 0, "end_ms": 300000, "script_excerpt": "Toàn bộ nội dung."}],
    })
    payload, chat_mock = _post(_body(60), output)

    _assert_valid(payload, 60_000)
    assert chat_mock.await_count == 1


def test_overlapping_segments_do_not_double_count_footage() -> None:
    output = json.dumps({
        "script_content": "Một. Hai.",
        "segments": [
            {"start_ms": 0, "end_ms": 50000, "script_excerpt": "Một."},
            {"start_ms": 10000, "end_ms": 60000, "script_excerpt": "Hai."},
        ],
    })
    payload, _ = _post(_body(60), output)

    _assert_valid(payload, 60_000)


def test_model_output_shape_variants_are_accepted() -> None:
    # Integer refs, float/string timestamps, whitespace-drifted excerpts and a
    # differently named top-level key are common across providers.
    output = json.dumps({
        "script": "Câu một   nói về chủ đề.\nCâu hai kết luận.",
        "segments": [
            {"start_ms": 0.0, "end_ms": "30000", "script_excerpt": "Câu một nói về chủ đề.", "source_sentence_refs": [0, 1]},
            {"start_ms": 30000, "end_ms": 60000.4, "script_excerpt": "Câu hai kết luận.", "source_sentence_refs": [6]},
        ],
    })
    payload, chat_mock = _post(_body(60), output)

    _assert_valid(payload, 60_000)
    assert chat_mock.await_count == 1
    assert all(isinstance(ref, str) for s in payload["segments"] for ref in s["source_sentence_refs"])


def test_invalid_segments_are_dropped_when_others_remain() -> None:
    output = json.dumps({
        "script_content": "Phần hợp lệ.",
        "segments": [
            {"start_ms": 5000, "end_ms": 5000, "script_excerpt": "Phần hợp lệ."},
            {"start_ms": 0, "end_ms": 60000, "script_excerpt": "Không có trong kịch bản."},
            {"start_ms": 0, "end_ms": 60000, "script_excerpt": "Phần hợp lệ."},
        ],
    })
    payload, _ = _post(_body(60), output)

    _assert_valid(payload, 60_000)
    assert len(payload["segments"]) == 1


def test_source_too_short_fails_without_repair_loop() -> None:
    output = json.dumps({
        "script_content": "Ngắn.",
        "segments": [{"start_ms": 0, "end_ms": 5000, "script_excerpt": "Ngắn."}],
    })
    payload, chat_mock = _post(_body(120, _transcript(count=4)), output)

    assert payload["status"] == "FAILED"
    assert payload["error_detail"]["errorCode"] == "PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION"
    assert "transcript covers only 20000 ms" in payload["error_detail"]["message"]
    assert chat_mock.await_count == 1
