from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.contract import Usage
from app.services import script_gateway
from app.services.provider_errors import ProviderErrorCode, ProviderException


def _request_body() -> dict:
    return {
        "correlation_id": "script-error-test",
        "media_job_id": "job-error-test",
        "transcript": [{"text": "A short source sentence.", "start_ms": 0, "end_ms": 10000}],
        "requested_duration_seconds": 5,
        "target_lang": "vi",
        "provider": {
            "protocol": "dashscope_native",
            "base_url": "https://dashscope.example/api",
            "api_key": "test-key",
            "model": "qwen-plus",
            "capabilities": ["TEXT"],
        },
    }


def _post_with_chat_result(chat_result) -> dict:
    with (
        patch.object(script_gateway.settings, "mock_mode", False),
        patch("app.services.script_gateway.chat", AsyncMock(return_value=chat_result)),
        TestClient(app) as client,
    ):
        response = client.post("/media/summarize/script", json=_request_body())
    assert response.status_code == 200
    return response.json()


def test_script_provider_quota_failure_keeps_full_structured_error_detail() -> None:
    failure = ProviderException(
        ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED,
        "Provider quota has been exhausted",
        protocol="dashscope_native",
        capability="TEXT",
        model="qwen-plus",
        details={"vendorStatus": "403", "vendorCode": "AllocationQuota.FreeTierOnly"},
    )
    with (
        patch.object(script_gateway.settings, "mock_mode", False),
        patch("app.services.script_gateway.chat", AsyncMock(side_effect=failure)),
        TestClient(app) as client,
    ):
        response = client.post("/media/summarize/script", json=_request_body())

    assert response.status_code == 200
    payload = response.json()
    detail = payload["error_detail"]
    assert payload["status"] == "FAILED"
    assert payload["error"] == "Provider quota has been exhausted"
    assert detail["errorCode"] == "PROVIDER_QUOTA_EXCEEDED"
    assert detail["title"] == "Quota Exceeded"
    assert detail["message"] == "Provider quota has been exhausted"
    assert detail["retryable"] is False
    assert detail["recommendedAction"]
    assert detail["protocol"] == "dashscope_native"
    assert detail["capability"] == "TEXT"
    assert detail["model"] == "qwen-plus"
    assert "vendorBody" not in detail


def test_script_malformed_output_uses_complete_typed_error_detail() -> None:
    payload = _post_with_chat_result(SimpleNamespace(text="not JSON", usage=None))

    detail = payload["error_detail"]
    assert payload["status"] == "FAILED"
    assert detail["errorCode"] == "PROVIDER_RESPONSE_MALFORMED"
    assert detail["message"] == "Model output did not match the script contract"
    assert isinstance(detail["retryable"], bool)
    assert detail["recommendedAction"]
    assert detail["protocol"] == "dashscope_native"
    assert detail["capability"] == "TEXT"
    assert detail["model"] == "qwen-plus"


def test_script_business_validation_failure_uses_complete_typed_error_detail() -> None:
    output = '{"script_content":"","segments":[]}'
    payload = _post_with_chat_result(SimpleNamespace(text=output, usage=None))

    detail = payload["error_detail"]
    assert payload["status"] == "FAILED"
    assert detail["errorCode"] == "PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION"
    assert detail["message"] == "Model returned an empty script or no matched video segments"
    assert detail["retryable"] is False
    assert detail["recommendedAction"]
    assert detail["protocol"] == "dashscope_native"
    assert detail["capability"] == "TEXT"
    assert detail["model"] == "qwen-plus"


def test_script_business_violation_is_repaired_with_violation_feedback() -> None:
    bad = '{"script_content":"Short script.","segments":[]}'
    good = '{"script_content":"Short script.","segments":[{"start_ms":0,"end_ms":5000,"script_excerpt":"Short script.","source_sentence_refs":["0"]}]}'
    usage = Usage(input_tokens=10, output_tokens=5, provider="dashscope_native", model="qwen-plus")
    chat_mock = AsyncMock(side_effect=[
        SimpleNamespace(text=bad, usage=usage),
        SimpleNamespace(text=good, usage=usage),
    ])
    with (
        patch.object(script_gateway.settings, "mock_mode", False),
        patch("app.services.script_gateway.chat", chat_mock),
        TestClient(app) as client,
    ):
        response = client.post("/media/summarize/script", json=_request_body())

    payload = response.json()
    assert payload["status"] == "COMPLETED"
    assert chat_mock.await_count == 2
    repair_prompt = chat_mock.await_args_list[1].args[2]
    assert "<previous_attempt_violation>" in repair_prompt
    assert "no matched video segments" in repair_prompt
    assert payload["usage"]["input_tokens"] == 20
    assert payload["usage"]["output_tokens"] == 10


def test_script_output_repair_is_bounded() -> None:
    chat_mock = AsyncMock(return_value=SimpleNamespace(text="not JSON", usage=None))
    with (
        patch.object(script_gateway.settings, "mock_mode", False),
        patch.object(script_gateway.settings, "script_output_repair_attempts", 2),
        patch("app.services.script_gateway.chat", chat_mock),
        TestClient(app) as client,
    ):
        response = client.post("/media/summarize/script", json=_request_body())

    assert response.json()["status"] == "FAILED"
    assert chat_mock.await_count == 3


def test_script_provider_failure_is_not_repaired() -> None:
    failure = ProviderException(
        ProviderErrorCode.PROVIDER_TIMEOUT,
        "Provider timed out",
        protocol="dashscope_native",
        capability="TEXT",
        model="qwen-plus",
    )
    chat_mock = AsyncMock(side_effect=failure)
    with (
        patch.object(script_gateway.settings, "mock_mode", False),
        patch("app.services.script_gateway.chat", chat_mock),
        TestClient(app) as client,
    ):
        response = client.post("/media/summarize/script", json=_request_body())

    assert response.json()["error_detail"]["errorCode"] == "PROVIDER_TIMEOUT"
    assert chat_mock.await_count == 1

