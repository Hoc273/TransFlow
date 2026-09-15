"""M17.1-C2 — Capture provider request ID tests.

- header exists -> captured via ChatResult.request_id
- header absent -> None / []
- no leak of api_key
"""
import json
import pytest
import httpx
from unittest.mock import AsyncMock, patch

from app.schemas.visual_contract import VisualSamplingConfig, ProviderPayload
from app.services.protocol.types import ChatResult, Usage
from app.services.protocol.openai_compatible import OpenAICompatibleAdapter
from app.services.visual import visual_cache
from app.services.visual.vlm_gateway import understand_visual


def test_chatresult_has_request_id_field():
    r = ChatResult(text="hello", usage=Usage(input_tokens=10, output_tokens=5, provider="openai_compatible", model="gpt-4o"), request_id="req-123")
    assert r.request_id == "req-123"
    r2 = ChatResult(text="hello", usage=Usage(input_tokens=1, output_tokens=1, provider="p", model="m"))
    assert r2.request_id is None


@pytest.mark.asyncio
async def test_openai_adapter_captures_x_request_id():
    adapter = OpenAICompatibleAdapter()
    provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="https://api.example.com/v1",
        api_key="sk-test-123",
        model="gpt-4o-mini",
        temperature=0.2,
    )

    # mock httpx response
    body = {
        "choices": [{"message": {"content": '{"people":1,"objects":[],"visualDescription":"test","confidence":0.9}'}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 20},
    }
    req = httpx.Request("POST", "https://api.example.com/v1/chat/completions")
    resp = httpx.Response(200, json=body, headers={"x-request-id": "req-abc-123"}, request=req)

    mock_client = AsyncMock()
    mock_client.__aenter__.return_value.post = AsyncMock(return_value=resp)
    mock_client.__aexit__.return_value = False

    with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=mock_client):
        result = await adapter.chat(provider, "system", "user hello", max_tokens=512)
        assert result.request_id == "req-abc-123"
        assert result.text != ""


@pytest.mark.asyncio
async def test_openai_adapter_request_id_none_when_absent():
    adapter = OpenAICompatibleAdapter()
    provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="https://api.example.com/v1",
        api_key="sk-test-123",
        model="gpt-4o-mini",
        temperature=0.2,
    )
    body = {
        "choices": [{"message": {"content": '{"people":0,"objects":[],"visualDescription":"empty","confidence":0.8}'}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }
    req = httpx.Request("POST", "https://api.example.com/v1/chat/completions")
    resp = httpx.Response(200, json=body, headers={}, request=req)

    mock_client = AsyncMock()
    mock_client.__aenter__.return_value.post = AsyncMock(return_value=resp)
    mock_client.__aexit__.return_value = False

    with patch("app.services.protocol.openai_compatible.httpx.AsyncClient", return_value=mock_client):
        result = await adapter.chat(provider, "system", "user", max_tokens=512)
        assert result.request_id is None


@pytest.mark.asyncio
async def test_vlm_gateway_aggregates_request_ids():
    # Use mocked adapter.chat returning ChatResult with request_id
    visual_cache.clear()
    provider_real = ProviderPayload(
        protocol="openai_compatible",
        base_url="https://api.example.com/v1",
        api_key="sk-test-real-key-123",  # makes is_real_provider true
        model="gpt-4o-mini",
        temperature=0.2,
    )
    # Patch _call_vlm_for_frame to return fake with _request_id to avoid network
    # Instead patch OpenAICompatibleAdapter.chat to return sequential ids
    call_count = {"n": 0}

    async def fake_chat(self, provider, system, user, **kwargs):
        call_count["n"] += 1
        return ChatResult(
            text=json.dumps({"people": 1, "objects": ["chair"], "location": "office", "action": "person speaking", "text": None, "visualDescription": f"frame {call_count['n']}", "confidence": 0.9}),
            usage=Usage(input_tokens=100, output_tokens=20, provider="openai_compatible", model=provider.model),
            finish_reason="stop",
            request_id=f"req-{call_count['n']:03d}",
        )

    # Need 2 frames
    with patch.object(OpenAICompatibleAdapter, "chat", fake_chat):
        # Provide dummy video file path that exists -> need to mock extraction path to avoid ffmpeg
        # Easiest: use frame_samples override so extraction not needed; real provider still goes through _call_vlm_for_frame
        result = await understand_visual(
            video_ref="bucket/test.mp4",
            video_url="https://example.com/test.mp4",
            provider=provider_real,
            sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=2, scene_aware=False),
            transcript=[],
            video_duration_ms=20000,
            frame_samples=[
                {"timestamp": 0, "frame_ref": "data:image/jpeg;base64,AAA", "scene_change_score": None, "is_scene_boundary": False},
                {"timestamp": 10000, "frame_ref": "data:image/jpeg;base64,BBB", "scene_change_score": None, "is_scene_boundary": False},
            ],
        )
        assert len(result["provider_request_ids"]) == 2
        assert result["provider_request_ids"] == ["req-001", "req-002"]
        assert result["usage"]["total_tokens"] == 240
        # api_key must not appear in provider_request_ids
        assert all("sk-" not in rid for rid in result["provider_request_ids"])


@pytest.mark.asyncio
async def test_provider_request_ids_empty_when_mock():
    visual_cache.clear()
    provider_mock = ProviderPayload(
        protocol="openai_compatible",
        base_url="https://api.openai.com/v1",
        api_key="",  # mock
        model="gpt-4o-mini",
        temperature=0.2,
    )
    result = await understand_visual(
        video_ref="bucket/mock.mp4",
        video_url="https://example.com/mock.mp4",
        provider=provider_mock,
        sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=2, scene_aware=False),
        transcript=[],
        video_duration_ms=20000,
    )
    assert result["provider_request_ids"] == []
    assert result["usage"] is None
