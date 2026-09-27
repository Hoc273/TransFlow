from __future__ import annotations

import httpx
import pytest

from app.schemas.contract import ProviderPayload
from app.services.protocol.http_utils import raise_for_http_status
from app.services.provider_errors import ProviderErrorCode, ProviderException


def provider(protocol: str = "dashscope_native", model: str = "qwen-plus") -> ProviderPayload:
    return ProviderPayload(
        protocol=protocol,
        base_url="https://provider.example/v1",
        api_key="secret-key",
        model=model,
    )


@pytest.mark.parametrize(
    "body",
    [
        {"code": "AllocationQuota.FreeTierOnly", "message": "free quota is exhausted"},
        {"error": {"code": "AllocationQuota.FreeTierOnly", "message": "quota"}},
    ],
)
def test_dashscope_free_tier_quota_403_is_not_permission_denied(body):
    response = httpx.Response(403, json=body)

    with pytest.raises(ProviderException) as caught:
        raise_for_http_status(response, provider(), operation="chat", capability="TEXT")

    assert caught.value.code == ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED
    assert caught.value.message == "Provider quota has been exhausted"
    assert caught.value.details == {
        "vendorStatus": "403",
        "vendorCode": "AllocationQuota.FreeTierOnly",
    }
    assert "free quota" not in str(caught.value)


def test_openai_insufficient_quota_429_is_not_rate_limited():
    response = httpx.Response(429, json={
        "error": {"code": "insufficient_quota", "message": "billing details omitted"},
    })

    with pytest.raises(ProviderException) as caught:
        raise_for_http_status(response, provider("openai_compatible"), operation="chat", capability="TEXT")

    assert caught.value.code == ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED
    assert caught.value.message == "Provider quota has been exhausted"


def test_model_not_found_vendor_code_is_classified_before_http_status():
    response = httpx.Response(400, json={"code": "ModelNotFound", "message": "unknown model"})

    with pytest.raises(ProviderException) as caught:
        raise_for_http_status(response, provider(), operation="chat", capability="TEXT")

    assert caught.value.code == ProviderErrorCode.PROVIDER_MODEL_NOT_FOUND


def test_actual_acl_403_remains_permission_denied():
    response = httpx.Response(403, json={"code": "AccessDenied", "message": "forbidden"})

    with pytest.raises(ProviderException) as caught:
        raise_for_http_status(response, provider(), operation="chat", capability="TEXT")

    assert caught.value.code == ProviderErrorCode.PROVIDER_PERMISSION_DENIED


def test_rate_limit_forwards_retry_after_seconds():
    response = httpx.Response(429, headers={"retry-after": "42"}, json={"error": {"message": "slow down"}})

    with pytest.raises(ProviderException) as caught:
        raise_for_http_status(response, provider("openai_compatible"), operation="tts", capability="TTS")

    assert caught.value.code == ProviderErrorCode.PROVIDER_RATE_LIMITED
    assert caught.value.details["retryAfterSeconds"] == "42"


def test_retry_after_http_date_and_garbage():
    from app.services.protocol.http_utils import retry_after_seconds

    assert retry_after_seconds("Wed, 21 Oct 2015 07:28:00 GMT") == 0
    assert retry_after_seconds("soon") is None
    assert retry_after_seconds(None) is None


def test_router_502_aggregating_an_upstream_401_stays_retryable():
    # Observed 2026-09-26: FreeLLMAPI returned 502 "All 2 routed attempt(s) failed ... Ollama Cloud
    # API error 401: Unauthorized"; classifying it as AUTH_FAILED stopped every retry.
    response = httpx.Response(502, json={"error": {"message": (
        "All 2 routed attempt(s) failed with upstream provider errors: "
        "Ollama Cloud API error 401: Unauthorized")}})

    with pytest.raises(ProviderException) as caught:
        raise_for_http_status(response, provider("openai_compatible"), operation="chat", capability="TEXT")

    assert caught.value.code == ProviderErrorCode.PROVIDER_INTERNAL_ERROR
    assert caught.value.retryable
