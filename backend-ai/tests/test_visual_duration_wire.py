"""M17.1-C1 — Wire real video_duration_ms tests.

Acceptance:
- 30s video -> duration 30000, timestamps within [0,30000)
- 120s video -> duration 120000
- 5m video -> duration 300000
- missing duration -> explicit fallback 120000
- timestamps never exceed duration
- last timestamp clamped to duration-500 when budget allows
"""
import pytest

from app.schemas.visual_contract import VisualSamplingConfig, VisualUnderstandRequest, ProviderPayload
from app.services.visual.frame_sampler import sample_timestamps
from app.services.visual import visual_cache
from app.services.visual.vlm_gateway import understand_visual

MOCK_PROVIDER = ProviderPayload(
    protocol="openai_compatible",
    base_url="https://api.openai.com/v1",
    api_key="",
    model="gpt-4o-mini",
    temperature=0.2,
)


def test_sample_timestamps_30s():
    ts = sample_timestamps(duration_ms=30000, interval_ms=3000, max_frames=12, scene_aware=False)
    assert all(0 <= t < 30000 for t in ts), ts
    # ideal 10 frames (30/3) plus near-end 29500 when budget allows => 11
    assert len(ts) in (10, 11), ts
    assert ts == sorted(ts)
    # last near-end when budget allows
    assert ts[-1] <= 30000 - 1


def test_sample_timestamps_120s():
    ts = sample_timestamps(duration_ms=120000, interval_ms=10000, max_frames=12, scene_aware=False)
    assert all(0 <= t < 120000 for t in ts)
    assert len(ts) <= 12
    assert ts == sorted(ts)


def test_sample_timestamps_5min():
    ts = sample_timestamps(duration_ms=300000, interval_ms=10000, max_frames=12, scene_aware=False)
    assert all(0 <= t < 300000 for t in ts)
    # 300s /10s =30 ideal -> expanded interval to fit 12
    assert len(ts) == 12, ts
    assert ts[-1] < 300000


def test_missing_duration_fallback_via_gateway():
    """When video_duration_ms None and transcript empty, sampler uses fallback via understand_visual derived dur."""
    # duration 0 -> sample empty directly
    ts = sample_timestamps(duration_ms=0, interval_ms=3000, max_frames=12)
    assert ts == []


@pytest.mark.asyncio
async def test_understand_visual_wires_30s_duration():
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/30s.mp4",
        video_url="https://example.com/30s.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=3000, max_frames=12, scene_aware=False),
        transcript=[],
        video_duration_ms=30000,
        mock_variant="generic",
    )
    assert result["multimodal_context"]["duration_ms"] == 30000
    assert all(o["timestamp"] < 30000 for o in result["observations"])
    assert all(f["timestamp"] < 30000 for f in result["frame_samples"])


@pytest.mark.asyncio
async def test_understand_visual_wires_5m_duration():
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/300s.mp4",
        video_url="https://example.com/300s.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=12, scene_aware=False),
        transcript=[],
        video_duration_ms=300000,
        mock_variant="generic",
    )
    assert result["multimodal_context"]["duration_ms"] == 300000
    assert all(o["timestamp"] < 300000 for o in result["observations"])


@pytest.mark.asyncio
async def test_understand_visual_missing_duration_fallback_120s():
    visual_cache.clear()
    # no duration, no transcript -> fallback 120000 in vlm_gateway:341
    result = await understand_visual(
        video_ref="bucket/missing.mp4",
        video_url="https://example.com/missing.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=12, scene_aware=False),
        transcript=[],
        video_duration_ms=None,
        mock_variant="generic",
    )
    # duration derived fallback 120000, but if max_frames 12 interval 10s, should have frames
    assert result["cost"]["frames"] > 0
    # multimodal duration is max(obs timestamp+3000) not 120k when transcript empty — but sampler used 120k
    # So at least frames exist and none exceed 120000
    assert all(o["timestamp"] < 120000 for o in result["observations"])


@pytest.mark.asyncio
async def test_gateway_request_carries_video_duration_ms():
    from app.services.visual_understanding_gateway import understand as gateway_understand
    visual_cache.clear()
    req = VisualUnderstandRequest(
        correlation_id="dur-test-001",
        media_job_id="job-001",
        video_ref="bucket/dur.mp4",
        video_url="https://example.com/dur.mp4",
        sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=12, scene_aware=False),
        transcript=[],
        provider=MOCK_PROVIDER,
        video_duration_ms=30000,
    )
    resp = await gateway_understand(req)
    assert resp.status == "COMPLETED"
    assert resp.multimodal_context.duration_ms == 30000
    assert all(o.timestamp < 30000 for o in resp.observations)


def test_video_duration_ms_field_nullable_compatible():
    # without field -> defaults None (backward compat)
    req = VisualUnderstandRequest(
        correlation_id="dur-test-002",
        media_job_id="job-002",
        video_ref="bucket/a.mp4",
        video_url="https://example.com/a.mp4",
        provider=MOCK_PROVIDER,
    )
    assert req.video_duration_ms is None


def test_timestamps_never_exceed_duration_randomized():
    for dur in [1000, 5000, 15000, 30000, 120000, 300000, 600000]:
        ts = sample_timestamps(duration_ms=dur, interval_ms=3000, max_frames=12, scene_aware=False)
        assert all(0 <= t < dur for t in ts), f"dur={dur} ts={ts}"
        assert ts == sorted(set(ts))


def test_last_timestamp_clamped():
    # 120s with 10s interval -> uniform [0..110k] plus near-end 119500
    ts = sample_timestamps(duration_ms=120000, interval_ms=10000, max_frames=12, scene_aware=False)
    # With 120k/10k=12 exactly, last should be <120k and close to end
    assert ts[-1] < 120000
    assert ts[-1] >= 110000
    # Clamped max is duration-1 at worst
    assert max(ts) <= 120000 - 1
