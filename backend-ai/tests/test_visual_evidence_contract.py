"""M17.1-C4 — Visual evidence contract tests.

Validates that evidence contains all required fields and never leaks secrets.
"""
import pytest

from app.schemas.visual_contract import VisualSamplingConfig, ProviderPayload, VisualUnderstandRequest
from app.services.visual import visual_cache
from app.services.visual.vlm_gateway import understand_visual


MOCK_PROVIDER = ProviderPayload(
    protocol="openai_compatible",
    base_url="https://api.openai.com/v1",
    api_key="",
    model="gpt-4o-mini",
    temperature=0.2,
)


@pytest.mark.asyncio
async def test_evidence_contains_required_fields():
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/evidence.mp4",
        video_url="https://example.com/evidence.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=3, scene_aware=False, prompt_version="v1"),
        transcript=[{"text": "hello", "start_ms": 0, "end_ms": 1000}],
        video_duration_ms=30000,
        mock_variant="generic",
    )
    # Required per C4 spec
    assert "observations" in result
    assert "scenes" in result
    assert "cost" in result
    assert "frame_samples" in result
    assert "multimodal_context" in result
    assert "usage" in result
    assert "provider_request_ids" in result
    assert "cache_hit" in result
    # cost details
    assert "estimated_cost_usd" in result["cost"]
    assert "frames" in result["cost"]
    # multimodal duration reflects passed video_duration_ms
    assert result["multimodal_context"]["duration_ms"] == 30000
    # timeline present (new contract)
    assert "timeline" in result["multimodal_context"]
    assert isinstance(result["multimodal_context"]["timeline"], list)
    # observations have required fields
    for obs in result["observations"]:
        assert "timestamp" in obs
        assert "people" in obs
        assert "visual_description" in obs
        assert "confidence" in obs
    # frame_samples have payload type via frame_ref containing #t= or data:
    for fs in result["frame_samples"]:
        assert "timestamp" in fs
        assert "frame_ref" in fs
        assert 0 <= fs["timestamp"] < 30000


@pytest.mark.asyncio
async def test_evidence_never_contains_secret():
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/secret.mp4",
        video_url="https://example.com/secret.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=2),
        transcript=[],
        video_duration_ms=20000,
        mock_variant="generic",
    )
    import json
    blob = json.dumps(result, ensure_ascii=False)
    lowered = blob.lower()
    # mock has no key, ensure blob does not leak placeholder
    assert "sk-" not in lowered
    for fs in result["frame_samples"]:
        assert "data:image" not in fs["frame_ref"]  # mock => placeholder, not base64


@pytest.mark.asyncio
async def test_provider_request_ids_is_list_and_not_fake():
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/ids.mp4",
        video_url="https://example.com/ids.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=2),
        transcript=[],
        video_duration_ms=20000,
    )
    assert isinstance(result["provider_request_ids"], list)
    # mock -> empty list (no fake ids)
    assert result["provider_request_ids"] == []


@pytest.mark.asyncio
async def test_evidence_usage_vs_estimated_distinction():
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/cost.mp4",
        video_url="https://example.com/cost.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=2, cost_per_image_tokens=800, max_total_image_tokens=12000),
        transcript=[],
        video_duration_ms=20000,
    )
    assert result["cost"]["estimated_cost_usd"] is not None
    # mock has no provider usage -> usage is None -> actual null
    assert result["usage"] is None


def test_wire_includes_video_duration_ms_and_provider_request_ids():
    req = VisualUnderstandRequest(
        correlation_id="ev-001",
        media_job_id="job-001",
        video_ref="bucket/a.mp4",
        video_url="https://example.com/a.mp4",
        provider=MOCK_PROVIDER,
        video_duration_ms=30000,
    )
    dumped = req.model_dump()
    assert dumped["video_duration_ms"] == 30000
    assert req.video_duration_ms == 30000

    from app.schemas.visual_contract import VisualUnderstandResponse
    resp = VisualUnderstandResponse(
        correlation_id="ev-001",
        status="COMPLETED",
        usage=None,
        provider_request_ids=[],
    )
    assert resp.provider_request_ids == []
    assert resp.usage is None
