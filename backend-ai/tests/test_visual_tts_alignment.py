"""Tests for Generative Summary Visual-TTS Alignment + Image Provider (TC-VIS-07..09)."""
import pytest
from app.core.config import Settings
from app.schemas.contract import (
    NarrativeIntentSlice,
    NarrativeSummarizeRequest,
    ProviderPayload,
    SttSegment,
)
from app.services.summary.visual_candidate_planner import (
    center_window_around_peak,
    generate_visual_candidates,
    align_visual_candidates_to_sections,
    VisualCandidate,
)
from app.services.narrative_summarize_gateway import summarize_narrative


def test_tc_vis_07_action_peak_centering():
    """TC-VIS-07: Window is accurately centered around action peak T_peak."""
    # Standard centering: T_peak = 26.8s, target = 5.0s -> [24.3s, 29.3s]
    start, end = center_window_around_peak(
        peak_ms=26800,
        target_duration_ms=5000,
        video_duration_ms=120000,
    )
    assert start == 24300
    assert end == 29300
    assert end - start == 5000

    # Left clamp: T_peak = 1.0s, target = 5.0s -> [0s, 5s]
    start_left, end_left = center_window_around_peak(
        peak_ms=1000,
        target_duration_ms=5000,
        video_duration_ms=120000,
    )
    assert start_left == 0
    assert end_left == 5000

    # Right clamp: T_peak = 119.0s, target = 5.0s, duration = 120s -> [115s, 120s]
    start_right, end_right = center_window_around_peak(
        peak_ms=119000,
        target_duration_ms=5000,
        video_duration_ms=120000,
    )
    assert start_right == 115000
    assert end_right == 120000


def test_tc_vis_08_sparse_speech_action_dominance():
    """TC-VIS-08: When dialogue is sparse, visual action intensity dominates scoring."""
    # Video duration 120s, dialogue is 1 word ("wow") -> < 10 wpm (sparse)
    transcript = [{"text": "wow", "start_ms": 5000, "end_ms": 6000}]
    observations = [
        {
            "timestamp": 25000,
            "action": "intense fight and kick sequence",
            "visual_description": "warriors fight with martial arts kicks",
            "confidence": 0.95,
        },
        {
            "timestamp": 5000,
            "action": "speaking at desk",
            "visual_description": "person sitting calmly at desk",
            "confidence": 0.80,
        },
    ]

    candidates = generate_visual_candidates(
        visual_observations=observations,
        video_duration_ms=120000,
        transcript_segments=transcript,
        target_candidate_duration_ms=5000,
    )

    assert len(candidates) >= 1
    # Action scene should have high action intensity (>= 0.90)
    fight_candidate = next((c for c in candidates if "fight" in c.dominant_action or "kick" in c.dominant_action), None)
    assert fight_candidate is not None
    assert fight_candidate.action_intensity >= 0.90
    assert fight_candidate.importance_score >= 0.70


def test_tc_vis_04_scene_boundaries_respected():
    """TC-VIS-04: Candidates strictly honor scene boundaries when scenes are provided."""
    scenes = [
        {"start_ms": 10000, "end_ms": 25000, "dominant_action": "kitchen prep"},
        {"start_ms": 25000, "end_ms": 45000, "dominant_action": "copper pot cooking"},
    ]
    observations = [
        {"timestamp": 12000, "action": "cutting ingredients", "visual_description": "chopping vegetables"},
        {"timestamp": 43000, "action": "stirring broth boiling", "visual_description": "stirring hot pot"},
    ]
    candidates = generate_visual_candidates(
        visual_observations=observations,
        visual_scenes=scenes,
        video_duration_ms=60000,
        target_candidate_duration_ms=5000,
    )
    assert len(candidates) == 2
    c1, c2 = candidates[0], candidates[1]
    # c1 must strictly reside within scene 1 [10000, 25000]
    assert 10000 <= c1.start_ms < c1.end_ms <= 25000
    # c2 must strictly reside within scene 2 [25000, 45000]
    assert 25000 <= c2.start_ms < c2.end_ms <= 45000


def test_tc_vis_06_invalid_vlm_timestamps_cannot_become_final_ranges():
    """TC-VIS-06: Invalid, negative, or out-of-bounds VLM timestamps are clamped to [0, duration]."""
    # 1. Negative timestamp clamp
    start_neg, end_neg = center_window_around_peak(
        peak_ms=-10000,
        target_duration_ms=5000,
        video_duration_ms=60000,
    )
    assert 0 <= start_neg < end_neg <= 60000
    assert start_neg == 0
    assert end_neg == 5000

    # 2. Exceeding video duration clamp
    start_over, end_over = center_window_around_peak(
        peak_ms=999999,
        target_duration_ms=5000,
        video_duration_ms=60000,
    )
    assert 0 <= start_over < end_over <= 60000
    assert end_over == 60000
    assert start_over == 55000

    # 3. generate_visual_candidates with out-of-bounds VLM observations
    bad_observations = [
        {"timestamp": -5000, "action": "pre-roll glitch", "visual_description": "glitch"},
        {"timestamp": 350000, "action": "post-roll hallucination", "visual_description": "hallucination"},
    ]
    candidates = generate_visual_candidates(
        visual_observations=bad_observations,
        video_duration_ms=60000,
        target_candidate_duration_ms=5000,
    )
    assert len(candidates) >= 1
    for c in candidates:
        assert 0 <= c.start_ms < c.end_ms <= 60000


def test_tc_vis_09_image_provider_settings_wire(monkeypatch):
    """TC-VIS-09: Configurable Image Provider settings wire properly from environment."""
    monkeypatch.setenv("IMAGE_PROVIDER_ENABLED", "true")
    monkeypatch.setenv("IMAGE_PROVIDER_TYPE", "openai_compatible")
    monkeypatch.setenv("IMAGE_PROVIDER_BASE_URL", "https://api.vlm.test/v1")
    monkeypatch.setenv("IMAGE_PROVIDER_API_KEY", "sk-custom-vlm-key")
    monkeypatch.setenv("IMAGE_PROVIDER_MODEL", "qwen-vl-max")
    monkeypatch.setenv("IMAGE_PROVIDER_TIMEOUT_MS", "45000")
    monkeypatch.setenv("IMAGE_PROVIDER_MAX_FRAMES", "16")
    monkeypatch.setenv("IMAGE_PROVIDER_INTERVAL_MS", "2500")

    cfg = Settings()
    assert cfg.image_provider_enabled is True
    assert cfg.image_provider_type == "openai_compatible"
    assert cfg.image_provider_base_url == "https://api.vlm.test/v1"
    assert cfg.image_provider_api_key == "sk-custom-vlm-key"
    assert cfg.image_provider_model == "qwen-vl-max"
    assert cfg.image_provider_timeout_ms == 45000
    assert cfg.image_provider_max_frames == 16
    assert cfg.image_provider_interval_ms == 2500


@pytest.mark.asyncio
async def test_visual_tts_alignment_integration_preserves_allocator_coverage():
    """VLM grounds a beat without replacing allocator-owned source coverage."""
    transcript = [
        SttSegment(text="Welcome everyone to our culinary adventure", start_ms=0, end_ms=15000),
        SttSegment(text="Today we prepare wild copper pot mushrooms", start_ms=15000, end_ms=30000),
        SttSegment(text="The broth simmers over high fire", start_ms=30000, end_ms=45000),
        SttSegment(text="And the dish is finally served hot", start_ms=45000, end_ms=60000),
    ]
    # Key visual action happens at 27.0s
    visual_observations = [
        {
            "timestamp": 27000,
            "action": "chef adds wild mushrooms into copper pot",
            "visual_description": "close up of fresh wild mushrooms entering steaming copper pot",
            "confidence": 0.95,
        }
    ]

    req = NarrativeSummarizeRequest(
        correlation_id="vis-sync-test-01",
        media_job_id="job-vis-sync-1",
        transcript=transcript,
        language="en",
        intent=NarrativeIntentSlice(
            goal_type="SUMMARIZE_GENERATIVE",
            tone_style_hints="cinematic",
            target_langs=["vi"],
        ),
        provider=ProviderPayload(
            protocol="openai_compatible",
            base_url="https://api.openai.com/v1",
            api_key="",  # triggers mock mode for deterministic test
            model="gpt-4o-mini",
        ),
        target_duration_ms=60000,
        visual_observations=visual_observations,
        duration_ms=60000,
    )

    resp = await summarize_narrative(req)
    assert resp.status == "COMPLETED"
    assert len(resp.plans) == 1
    plan = resp.plans[0]
    assert len(plan.sections) >= 1

    refs = [ref for section in plan.sections for ref in section.source_refs]
    assert sum(ref.end_ms - ref.start_ms for ref in refs) == 60_000
    assert any(ref.start_ms <= 27_000 <= ref.end_ms for ref in refs)
    for section in plan.sections:
        ordered = sorted(section.source_refs, key=lambda ref: ref.start_ms)
        assert all(a.end_ms >= b.start_ms for a, b in zip(ordered, ordered[1:]))


@pytest.mark.asyncio
async def test_vlm_does_not_replace_540s_to_300s_allocator_budget():
    """A VLM candidate set must not turn a five-minute budget into N*5s."""
    transcript = [
        SttSegment(text=f"Timed transcript block {idx}", start_ms=idx * 60_000, end_ms=(idx + 1) * 60_000)
        for idx in range(9)
    ]
    visual_observations = [
        {
            "timestamp": idx * 60_000 + 30_000,
            "action": "visible action",
            "visual_description": f"scene {idx}",
            "confidence": 0.9,
        }
        for idx in range(9)
    ]
    req = NarrativeSummarizeRequest(
        correlation_id="vis-budget-test-01",
        media_job_id="job-vis-budget-1",
        transcript=transcript,
        language="en",
        intent=NarrativeIntentSlice(goal_type="SUMMARIZE_GENERATIVE"),
        provider=ProviderPayload(protocol="openai_compatible", base_url="https://api.openai.com/v1", api_key="", model="gpt-4o-mini"),
        target_duration_ms=300_000,
        visual_observations=visual_observations,
        duration_ms=540_000,
    )

    resp = await summarize_narrative(req)
    assert resp.status == "COMPLETED"
    plan = resp.plans[0]
    refs = [ref for section in plan.sections for ref in section.source_refs]
    coverage_ms = sum(ref.end_ms - ref.start_ms for ref in refs)
    assert 270_000 <= coverage_ms <= 330_000
    assert coverage_ms == 300_000
    for section in plan.sections:
        ordered = sorted(section.source_refs, key=lambda ref: ref.start_ms)
        assert all(a.end_ms >= b.start_ms for a, b in zip(ordered, ordered[1:]))
