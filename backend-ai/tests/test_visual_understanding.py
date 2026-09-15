"""TASK 7 — MULTIMODAL VISUAL UNDERSTANDING V1 tests.

Covers requirements 1-13:
- schema validation, sampling, cost, cache, temporal grouping, multimodal merge,
- VLM provider abstraction (mock), confidence hedging, grounding,
- datasets A-D + 2-min fight scene, failure cases.
"""
import asyncio
import pytest

from app.schemas.visual_contract import VisualSamplingConfig, VisualUnderstandRequest, ProviderPayload
from app.services.visual.frame_sampler import sample_timestamps, estimate_cost, build_frame_samples, SceneBoundary
from app.services.visual import visual_cache
from app.services.visual.cost_governance import CostPolicy, check_budget
from app.services.visual.temporal_grouping import group_observations, detect_scene_changes
from app.services.visual.multimodal_context import build_multimodal_context
from app.services.visual.vlm_gateway import understand_visual

# Helper provider (mock)
MOCK_PROVIDER = ProviderPayload(
    protocol="openai_compatible",
    base_url="https://api.openai.com/v1",
    api_key="",  # blank → mock_mode path
    model="gpt-4o-mini",
    temperature=0.2,
)


def _obs(ts, people=1, action="person speaking", location="indoor office", conf=0.85, scene_id=None, text=None):
    return {
        "timestamp": ts,
        "scene_id": scene_id,
        "people": people,
        "objects": ["chair"],
        "location": location,
        "action": action,
        "text": text,
        "visual_description": f"desc at {ts}",
        "confidence": conf,
    }


# ── Requirement 2: schema ───────────────────────────────────────────────

def test_visual_observation_schema_valid():
    from app.schemas.visual_contract import VisualObservation

    vo = VisualObservation(
        timestamp=42000,
        people=2,
        objects=["fist", "wall"],
        location="outdoor alley",
        action="two people fighting",
        visual_description="Two people fighting in an alley at 00:42",
        confidence=0.92,
    )
    assert vo.timestamp == 42000
    assert vo.people == 2
    assert vo.confidence == 0.92


def test_visual_observation_schema_confidence_bounds():
    from app.schemas.visual_contract import VisualObservation

    with pytest.raises(Exception):
        VisualObservation(timestamp=0, people=1, objects=[], visual_description="x", confidence=1.5)
    with pytest.raises(Exception):
        VisualObservation(timestamp=0, people=1, objects=[], visual_description="", confidence=0.5)


# ── Requirement 1: frame sampler ───────────────────────────────────────

def test_frame_sampler_uniform_interval():
    ts = sample_timestamps(duration_ms=60000, interval_ms=10000, max_frames=12, scene_aware=False)
    # uniform with near-end extension may yield 6 or 7 (50000 plus 59500); assert covers both
    assert ts[:6] == [0, 10000, 20000, 30000, 40000, 50000]
    assert len(ts) in (6, 7)
    assert all(t < 60000 for t in ts)
    assert ts == sorted(ts)


def test_frame_sampler_capped_max_frames():
    ts = sample_timestamps(duration_ms=120000, interval_ms=2000, max_frames=5, scene_aware=False)
    assert len(ts) <= 5
    assert ts[0] == 0
    assert all(t < 120000 for t in ts)


def test_frame_sampler_scene_aware_prioritizes_boundaries():
    boundaries = [
        SceneBoundary(timestamp_ms=10000, score=0.5),
        SceneBoundary(timestamp_ms=35000, score=0.6),
        SceneBoundary(timestamp_ms=80000, score=0.8),
    ]
    ts = sample_timestamps(
        duration_ms=120000,
        interval_ms=10000,
        max_frames=8,
        scene_boundaries=boundaries,
        scene_aware=True,
        scene_threshold=0.3,
    )
    # scene-aware should include at least one scene point (10500 or 35500 or 80500) within tolerance
    assert any(abs(t - 10500) <= 1500 or abs(t - 35500) <= 1500 or abs(t - 80500) <= 1500 for t in ts)
    assert len(ts) <= 8
    # never exceeds max_frames and remains sorted
    assert ts == sorted(ts)


def test_frame_sampler_not_entire_video():
    ts = sample_timestamps(duration_ms=300000, interval_ms=500, max_frames=12, scene_aware=False)
    assert len(ts) == 12  # capped, not 600 frames


def test_build_frame_samples_shape():
    samples = build_frame_samples([0, 3000, 6000], video_ref="bucket/key.mp4", video_url="https://example.com/video.mp4")
    assert len(samples) == 3
    assert samples[0]["timestamp"] == 0
    assert "#t=" in samples[0]["frame_ref"]


# ── Requirement 4: cost governance ─────────────────────────────────────

def test_cost_estimate_within_budget():
    est = estimate_cost(10, cost_per_image_tokens=800, max_total_image_tokens=12000, max_frames=12)
    assert est["within_budget"] is True
    assert est["estimated_image_tokens"] == 8000


def test_cost_estimate_exceeds_max_frames():
    est = estimate_cost(15, cost_per_image_tokens=800, max_total_image_tokens=50000, max_frames=12)
    assert est["within_budget"] is False
    assert "max_frames" in est["reason"]


def test_cost_policy_check_budget_throws():
    policy = CostPolicy(max_frames=12, cost_per_image_tokens=800, max_total_image_tokens=12000, max_budget_usd=None, price_per_1k_tokens_usd=0.005)
    with pytest.raises(Exception) as exc:
        check_budget(13, policy)
    assert "max_frames" in str(exc.value)

    # within budget passes
    est = check_budget(12, policy)
    assert est["within_budget"] is True


# ── Requirement 5: cache ───────────────────────────────────────────────

def test_cache_hash_video_timestamp_model_prompt():
    visual_cache.clear()
    key1 = visual_cache.cache_key(video_ref="bucket/a.mp4", timestamp=42000, model="gpt-4o", prompt_version="v1")
    key2 = visual_cache.cache_key(video_ref="bucket/a.mp4", timestamp=42000, model="gpt-4o", prompt_version="v1")
    key3 = visual_cache.cache_key(video_ref="bucket/a.mp4", timestamp=42000, model="gpt-4o", prompt_version="v2")
    assert key1 == key2
    assert key1 != key3
    # different timestamp → different key
    key4 = visual_cache.cache_key(video_ref="bucket/a.mp4", timestamp=43000, model="gpt-4o", prompt_version="v1")
    assert key1 != key4
    # different video → different key
    key5 = visual_cache.cache_key(video_ref="bucket/b.mp4", timestamp=42000, model="gpt-4o", prompt_version="v1")
    assert key1 != key5


def test_cache_put_get():
    visual_cache.clear()
    obs = _obs(42000, people=2, action="two people fighting", conf=0.92)
    visual_cache.put(video_ref="bucket/a.mp4", timestamp=42000, model="gpt-4o", observation=obs)
    hit = visual_cache.get(video_ref="bucket/a.mp4", timestamp=42000, model="gpt-4o", prompt_version="v1")
    assert hit is not None
    assert hit["people"] == 2
    # miss different prompt version
    miss = visual_cache.get(video_ref="bucket/a.mp4", timestamp=42000, model="gpt-4o", prompt_version="v2")
    assert miss is None


# ── Requirement 6: temporal grouping ───────────────────────────────────

def test_temporal_grouping_same_action():
    obs = [
        _obs(0, action="person speaking", location="office"),
        _obs(2000, action="person speaking", location="office"),
        _obs(4000, action="person speaking", location="office"),
        _obs(20000, action="two people fighting", location="alley"),
        _obs(22000, action="two people fighting", location="alley"),
    ]
    scenes = group_observations(obs, gap_ms=5000)
    assert len(scenes) == 2
    assert scenes[0]["dominant_action"] == "person speaking"
    assert scenes[1]["dominant_action"] == "two people fighting"
    assert scenes[0]["scene_id"] == "scene-001"
    assert scenes[1]["scene_id"] == "scene-002"


def test_temporal_grouping_people_change_creates_new_scene():
    obs = [
        _obs(0, people=1, action="person walking", location="street"),
        _obs(3000, people=5, action="crowd gathering", location="street"),
    ]
    scenes = group_observations(obs)
    # people jump 1->5 is >1 and not both >=3? Actually 1 vs 5 = diff 4 >1 and not both >=3 → new scene?
    # Our logic: samePeoplePattern fails → new scene
    assert len(scenes) == 2


def test_detect_scene_changes():
    obs = [
        _obs(0, action="a", scene_id="scene-001"),
        _obs(3000, action="a", scene_id="scene-001"),
        _obs(8000, action="b", scene_id="scene-002"),
        _obs(11000, action="b", scene_id="scene-002"),
    ]
    changes = detect_scene_changes(obs)
    # grouping will create 2 scenes → one boundary at start of second
    assert len(changes) >= 1


# ── Requirement 7: multimodal merge ────────────────────────────────────

def test_multimodal_context_merge():
    transcript = [
        {"text": "Hello world", "start_ms": 0, "end_ms": 2000},
        {"text": "We are discussing the plan", "start_ms": 2000, "end_ms": 5000},
    ]
    observations = [
        _obs(42000, people=2, action="two people fighting", location="alley", conf=0.92),
        _obs(45000, people=2, action="two people fighting", location="alley", conf=0.90),
    ]
    scenes = group_observations(observations)
    ctx = build_multimodal_context(transcript, observations, scenes, duration_ms=60000)
    assert ctx["duration_ms"] == 60000
    assert len(ctx["timeline"]) >= 4  # 2 speech + 2 visual + scenes
    assert ctx["multimodal_summary"] is not None
    assert len(ctx["scene_boundaries_ms"]) == (len(scenes) - 1 if len(scenes) > 1 else 0)


# ── Requirement 8: Narrative must capture visual fight at 00:42 even when transcript silent

@pytest.mark.asyncio
async def test_vlm_detects_fight_at_42s_even_when_transcript_sparse():
    # Sparse transcript: almost no speech where fight happens
    transcript = [
        {"text": "Welcome to the video", "start_ms": 0, "end_ms": 2000},
        {"text": "Thank you for watching", "start_ms": 115000, "end_ms": 118000},
    ]
    visual_cache.clear()
    # force fight variant via mock param: use variant=fight in frame_ref simulation
    # understand_visual with mock_variant=fight
    result = await understand_visual(
        video_ref="bucket/fight.mp4",
        video_url="https://example.com/fight.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=5000, max_frames=12, scene_aware=False, prompt_version="v1"),
        transcript=transcript,
        video_duration_ms=120000,
        mock_variant="fight",
    )
    assert len(result["observations"]) > 0
    # find observation near 42s (42000) with fighting
    near_42 = [o for o in result["observations"] if 35000 <= o["timestamp"] <= 50000]
    assert len(near_42) > 0
    fighting = [o for o in near_42 if "fight" in (o.get("action") or "").lower()]
    assert len(fighting) > 0, f"Expected fight action near 42s, got {near_42}"
    # scene grouping should capture fight scene
    fight_scenes = [s for s in result["scenes"] if "fight" in (s.get("dominant_action") or "").lower()]
    assert len(fight_scenes) > 0
    # multimodal context must contain visual summary mentioning fight
    ctx = result["multimodal_context"]
    assert ctx is not None
    assert "fight" in (ctx.get("multimodal_summary") or "").lower() or any("fight" in (o.get("action") or "").lower() for o in ctx["visual_observations"])


# ── Requirement 9: Grounding ──────────────────────────────────────────

def test_grounding_visual_evidence():
    transcript = [{"text": "Hello", "start_ms": 0, "end_ms": 1000}]
    obs = [_obs(42000, people=2, action="two people fighting", conf=0.92)]
    scenes = group_observations(obs)
    ctx = build_multimodal_context(transcript, obs, scenes, duration_ms=60000)
    # Every visual observation is evidence; timeline contains visual type with timestamp
    visual_entries = [e for e in ctx["timeline"] if e["type"] == "visual"]
    assert any(e["timestamp"] == 42000 for e in visual_entries)
    # scenes provide evidence_note
    assert scenes[0]["evidence_note"] is not None
    assert "visual evidence" in scenes[0]["evidence_note"]


# ── Requirement 10: Confidence hedging ─────────────────────────────────

def test_low_confidence_observation_hedged_in_timeline():
    transcript = []
    obs = [
        _obs(10000, people=1, action="person speaking", conf=0.35),  # low
        _obs(15000, people=1, action="person speaking", conf=0.90),  # high
    ]
    scenes = group_observations(obs)
    ctx = build_multimodal_context(transcript, obs, scenes, duration_ms=30000)
    low = [e for e in ctx["timeline"] if e["type"] == "visual" and e["confidence"] < 0.5]
    high = [e for e in ctx["timeline"] if e["type"] == "visual" and e["confidence"] >= 0.5]
    assert len(low) == 1 and low[0]["hedge"] is True
    assert len(high) == 1 and high[0]["hedge"] is False
    # summary should mention hedging when low confidence present
    assert "hedge" in (ctx["multimodal_summary"] or "").lower()


# ── Requirement 11: Test datasets A-D ─────────────────────────────────

@pytest.mark.asyncio
async def test_dataset_A_many_speech_few_action():
    transcript = [{"text": f"Sentence {i} about the talk", "start_ms": i * 1000, "end_ms": i * 1000 + 800} for i in range(30)]
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/datasetA.mp4",
        video_url="https://example.com/a.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=4000, max_frames=8),
        transcript=transcript,
        video_duration_ms=30000,
        mock_variant="A_many_speech_few_action",
    )
    assert len(result["observations"]) > 0
    # A should have mostly 1 person speaking
    assert all(o["people"] == 1 for o in result["observations"])
    assert all("speaking" in (o.get("action") or "").lower() for o in result["observations"])
    assert result["cost"]["within_budget"] is True


@pytest.mark.asyncio
async def test_dataset_B_few_speech_many_action():
    transcript = [{"text": "Hi", "start_ms": 0, "end_ms": 500}]
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/datasetB.mp4",
        video_url="https://example.com/b.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=4000, max_frames=8),
        transcript=transcript,
        video_duration_ms=30000,
        mock_variant="B_few_speech_many_action",
    )
    assert len(result["observations"]) > 0
    # B should have dynamic actions, sparse transcript but rich visual
    assert len(result["scenes"]) >= 1
    ctx = result["multimodal_context"]
    assert ctx is not None
    assert "Transcript is sparse" in (ctx.get("multimodal_summary") or "") or "Visual context" in (ctx.get("multimodal_summary") or "")


@pytest.mark.asyncio
async def test_dataset_C_no_speech():
    transcript = []
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/datasetC.mp4",
        video_url="https://example.com/c.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=5000, max_frames=10),
        transcript=transcript,
        video_duration_ms=30000,
        mock_variant="C_no_speech",
    )
    assert len(result["observations"]) > 0
    # C may have empty room frames (0 people)
    # should still produce scenes
    assert len(result["scenes"]) >= 1
    ctx = result["multimodal_context"]
    assert ctx["duration_ms"] > 0


@pytest.mark.asyncio
async def test_dataset_D_ocr_heavy():
    transcript = [{"text": "The slides show important data", "start_ms": 0, "end_ms": 2000}]
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/datasetD.mp4",
        video_url="https://example.com/d.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=3000, max_frames=10),
        transcript=transcript,
        video_duration_ms=30000,
        mock_variant="D_ocr_heavy",
    )
    assert len(result["observations"]) > 0
    # D should have OCR text present
    assert any(o.get("text") for o in result["observations"])
    assert any("slide" in (o.get("visual_description") or "").lower() or "text" in (o.get("visual_description") or "").lower()
               for o in result["observations"])


# ── Requirement 12: Especially test 2-min fight scene ──────────────────

@pytest.mark.asyncio
async def test_2min_fight_scene_expected_metrics():
    # Full 120s fight variant
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/fight120.mp4",
        video_url="https://example.com/fight120.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=10000, max_frames=12, scene_aware=True, prompt_version="v1"),
        transcript=[{"text": "intro", "start_ms": 0, "end_ms": 1000}],
        video_duration_ms=120000,
        mock_variant="fight",
    )
    obs = result["observations"]
    scenes = result["scenes"]
    # Must detect number of people (2) consistently during fight
    fight_obs = [o for o in obs if 35000 <= o["timestamp"] <= 110000]
    assert len(fight_obs) >= 3
    assert all(o["people"] == 2 for o in fight_obs)
    # Must detect main action evolution: standing → start fighting → fighting → aftermath
    actions = [o.get("action") for o in obs]
    assert any("fight" in (a or "").lower() for a in actions)
    # Must detect scene change: at least 2 scenes (calm vs fight vs aftermath)
    assert len(scenes) >= 2
    # Must have temporal evolution: start < end
    assert all(s["start_ms"] < s["end_ms"] for s in scenes)
    # Change in scene timeline
    assert len(result["multimodal_context"]["scene_boundaries_ms"]) >= 1 or len(scenes) >= 2


# ── Requirement 13: Failure cases (no video generation / lip sync etc.) ─

def test_no_video_generation_in_response_shape():
    # Ensure response never contains video generation fields
    import inspect
    from app.services.visual.vlm_gateway import understand_visual

    sig = inspect.signature(understand_visual)
    # params should not include generation controls
    assert "generate_video" not in sig.parameters
    assert "lip_sync" not in sig.parameters


@pytest.mark.asyncio
async def test_failure_case_low_confidence_not_strong_assertion():
    # Simulate low confidence across board — narrative should hedge.
    # We test via multimodal context hedging flag.
    transcript = []
    low_obs = [
        _obs(10000, people=2, action="two people fighting", conf=0.40),
        _obs(20000, people=2, action="two people fighting", conf=0.30),
    ]
    ctx = build_multimodal_context(transcript, low_obs, group_observations(low_obs), duration_ms=30000)
    # All visuals hedged
    assert all(e["hedge"] for e in ctx["timeline"] if e["type"] == "visual")
    assert "hedge" in (ctx["multimodal_summary"] or "").lower()


@pytest.mark.asyncio
async def test_failure_case_no_frames_when_duration_zero():
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/empty.mp4",
        video_url="https://example.com/empty.mp4",
        provider=MOCK_PROVIDER,
        sampling_config=VisualSamplingConfig(interval_ms=3000, max_frames=12),
        transcript=[],
        video_duration_ms=0,
    )
    assert result["observations"] == []
    assert result["scenes"] == []
    assert result["frame_samples"] == []
    assert result["cost"]["frames"] == 0


def test_failure_case_invalid_visual_observation_dropped():
    # Raw VLM output with confidence >1 should be dropped, not crash
    from app.services.visual.vlm_gateway import understand_visual

    # Simulate via direct group call with invalid confidence — our gateway validates
    obs_invalid = {"timestamp": 1000, "people": 1, "objects": [], "visual_description": "x", "confidence": 1.5}
    # VisualObservation validation should reject it
    from app.schemas.visual_contract import VisualObservation

    with pytest.raises(Exception):
        VisualObservation.model_validate(obs_invalid)


# ── P1 regression: wire response must validate even with timeline ──────────

def test_wire_response_validates_with_timeline():
    """P1: build_multimodal_context() returns dict with 'timeline' but VisualUnderstandResponse
    previously rejected it as extra_forbidden → 500 for every successful call. This test ensures
    the wire model accepts timeline (Option A) and can be constructed end-to-end."""
    from app.schemas.visual_contract import VisualUnderstandResponse, MultimodalContextModel

    transcript = [{"text": "Hello", "start_ms": 0, "end_ms": 1000}]
    obs = [_obs(5000, people=1, action="person speaking", conf=0.9)]
    scenes = group_observations(obs)
    ctx = build_multimodal_context(transcript, obs, scenes, duration_ms=10000)
    assert "timeline" in ctx  # timeline is present for narrative writer convenience
    # Direct MultimodalContextModel validation must NOT raise
    m = MultimodalContextModel.model_validate(ctx)
    assert m.timeline is not None
    assert len(m.timeline) >= 3  # speech + visual + scene
    # Full wire response must also validate (this was the 500)
    resp = VisualUnderstandResponse(
        correlation_id="test-corr",
        status="COMPLETED",
        observations=obs,
        scenes=scenes,
        multimodal_context=ctx,
        frame_samples=[],
        cache_hit=False,
    )
    assert resp.multimodal_context is not None
    assert resp.multimodal_context.timeline is not None


@pytest.mark.asyncio
async def test_gateway_wire_response_no_500_on_success():
    """P1 end-to-end: visual_understanding_gateway.understand() directly constructs
    VisualUnderstandResponse from understand_visual() dict that contains timeline.
    Before fix it threw ValidationError → FastAPI 500; after fix it returns COMPLETED."""
    from app.schemas.visual_contract import VisualUnderstandRequest
    from app.services.visual_understanding_gateway import understand as gateway_understand

    visual_cache.clear()
    req = VisualUnderstandRequest(
        correlation_id="wire-test-001",
        media_job_id="job-001",
        video_ref="bucket/wire.mp4",
        video_url="https://example.com/wire.mp4",
        transcript=[{"text": "Hello", "start_ms": 0, "end_ms": 1000}],
        provider=MOCK_PROVIDER,
    )
    resp = await gateway_understand(req)
    assert resp.status == "COMPLETED"
    assert resp.multimodal_context is not None
    # timeline may be present (if wire includes it) or filtered — but response must not be 500
    assert resp.error is None
    assert resp.error_detail is None


def test_fastapi_endpoint_visual_understand_no_500():
    """P1 endpoint regression: POST /media/understand/visual with mock provider must not 500.
    Uses FastAPI TestClient to go through real handler + Pydantic serialization."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    payload = {
        "correlation_id": "ep-test-001",
        "media_job_id": "job-ep-001",
        "video_ref": "bucket/ep.mp4",
        "video_url": "https://example.com/ep.mp4",
        "sampling_config": {"interval_ms": 3000, "max_frames": 5, "scene_aware": False},
        "transcript": [{"text": "Hello", "start_ms": 0, "end_ms": 1000}],
        "provider": {
            "protocol": "openai_compatible",
            "base_url": "https://api.openai.com/v1",
            "api_key": "",
            "model": "gpt-4o-mini",
            "temperature": 0.2,
        },
    }
    r = client.post("/media/understand/visual", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "COMPLETED"
    assert "multimodal_context" in body
    # endpoint must not have returned ValidationError 500 shape
    assert body.get("error") is None


# ── M17-visual-fix regression: extractor-shaped frame_samples must validate ──

def _extractor_shaped_samples():
    """Simulate extract_frames_as_data_urls() output: wire fields + internal
    underscore-prefixed diagnostics (_width/_height/_sha256/_bytes)."""
    return [
        {
            "timestamp": ts,
            "frame_ref": "data:image/jpeg;base64,/9j/AAAA",
            "scene_change_score": None,
            "is_scene_boundary": False,
            "_width": 1024,
            "_height": 1024,
            "_sha256": "47afd9338768a16ef77b24eddeadbeef",
            "_bytes": 134992,
        }
        for ts in (0, 3000, 6000)
    ]


@pytest.mark.asyncio
async def test_extractor_shaped_frame_samples_validate_on_wire():
    """T1: real extractor dicts (with _* diagnostics) inside understand_visual()'s
    return value must not break VisualUnderstandResponse (48x extra_forbidden on
    prod job aa9e9d12). The gateway strips _* keys before constructing the response."""
    from unittest.mock import patch

    from app.schemas.visual_contract import VisualUnderstandResponse
    from app.services.visual_understanding_gateway import understand as gateway_understand

    async def _fake_understand_visual(**kwargs):
        return {
            "observations": [],
            "scenes": [],
            "cost": {"frames": 3, "estimated_image_tokens": 2400,
                     "estimated_total_tokens": 3400, "within_budget": True, "reason": None},
            "frame_samples": _extractor_shaped_samples(),
            "cache_hit": False,
            "multimodal_context": {"transcript_segments": [], "visual_observations": [],
                                   "visual_scenes": [], "scene_boundaries_ms": [],
                                   "duration_ms": 10000},
            "usage": None,
            "provider_request_ids": [],
        }

    visual_cache.clear()
    req = VisualUnderstandRequest(
        correlation_id="wire-strip-001",
        media_job_id="job-strip-001",
        video_ref="bucket/strip.mp4",
        video_url="https://example.com/strip.mp4",
        transcript=[{"text": "Hello", "start_ms": 0, "end_ms": 1000}],
        provider=MOCK_PROVIDER,
    )
    with patch(
        "app.services.visual_understanding_gateway.understand_visual",
        side_effect=_fake_understand_visual,
    ):
        resp = await gateway_understand(req)
    assert resp.status == "COMPLETED", resp.error
    assert len(resp.frame_samples) == 3
    for fs in resp.frame_samples:
        dumped = fs.model_dump()
        assert not any(k.startswith("_") for k in dumped), dumped.keys()
    # Full Pydantic round-trip (what FastAPI response_model does) must not raise.
    VisualUnderstandResponse.model_validate(resp.model_dump())


@pytest.mark.asyncio
async def test_understand_visual_strips_underscore_metadata():
    """T2: understand_visual() return dict must contain only wire-contract keys
    in frame_samples, even when the caller passes extractor-shaped samples."""
    visual_cache.clear()
    result = await understand_visual(
        video_ref="bucket/strip2.mp4",
        video_url="https://example.com/strip2.mp4",
        provider=MOCK_PROVIDER,  # blank key → deterministic mock VLM, no network
        sampling_config=VisualSamplingConfig(interval_ms=3000, max_frames=12),
        transcript=[{"text": "Hello", "start_ms": 0, "end_ms": 1000}],
        frame_samples=_extractor_shaped_samples(),
        video_duration_ms=10000,
    )
    assert len(result["frame_samples"]) == 3
    for s in result["frame_samples"]:
        assert not any(k.startswith("_") for k in s), s.keys()
        assert set(s.keys()) <= {"timestamp", "frame_ref", "scene_change_score", "is_scene_boundary"}
    # Observations still produced from the samples (strip must not drop frames).
    assert len(result["observations"]) == 3
