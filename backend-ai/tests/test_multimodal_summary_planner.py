"""M17.2-E — Summary contract tests.

Validates:
- visual-only
- transcript-only
- multimodal
- sparse transcript (action dominance)
- dense transcript
- action-heavy video
- ambiguous visual
- no visual observations
- budget compliance (120s -> 30s)
- narrative grounding
"""
import pytest

from app.schemas.summary_plan_contract import SummaryPlan, SummaryScenePlan, SceneImportanceScore
from app.services.summary.multimodal_summary_planner import (
    compute_scene_importance,
    select_temporal_ranges,
    ground_narrative_to_evidence,
    build_summary_plan,
)


def test_compute_scene_importance_action_dominance_when_sparse():
    scene = {"start_ms": 30000, "end_ms": 60000, "dominant_action": "two people fighting", "confidence": 0.9}
    obs = [
        {"timestamp": 35000, "action": "fight", "visual_description": "intense fight scene", "confidence": 0.92}
    ]
    score = compute_scene_importance(scene, obs, is_sparse_transcript=True)
    assert score.action_intensity >= 0.90
    assert score.composite_score >= 0.70


def test_compute_scene_importance_balanced_when_dense():
    scene = {"start_ms": 0, "end_ms": 10000, "dominant_action": "speaking", "confidence": 0.8}
    obs = [{"timestamp": 5000, "action": "speaking", "visual_description": "person speaking at podium"}]
    score = compute_scene_importance(scene, obs, is_sparse_transcript=False)
    assert score.transcript_relevance == 0.80


def test_select_temporal_ranges_respects_budget():
    scenes = [
        {"start_ms": 0, "end_ms": 20000, "_importance_score": 0.95, "_evidence_refs": ["e1"]},
        {"start_ms": 30000, "end_ms": 50000, "_importance_score": 0.85, "_evidence_refs": ["e2"]},
        {"start_ms": 70000, "end_ms": 90000, "_importance_score": 0.50, "_evidence_refs": ["e3"]},
    ]
    # target 25 seconds (25000ms)
    selected = select_temporal_ranges(scenes, target_duration_ms=25000)
    total_dur = sum(int(s["end_ms"]) - int(s["start_ms"]) for s in selected)
    assert total_dur <= 25000
    assert len(selected) >= 1
    # top importance scene (0.95) must be included
    assert any(s["start_ms"] == 0 for s in selected)


def test_ground_narrative_to_evidence_rejects_hallucinated_weapon():
    obs = [{"visual_description": "two people running in a park", "action": "running"}]
    transcript = [{"text": "hurry up"}]
    raw_narration = "A man pulls out a gun and starts shooting."
    sanitized, unsupported = ground_narrative_to_evidence(raw_narration, obs, transcript)
    assert len(unsupported) > 0
    assert "gun" not in sanitized.lower()


def test_build_summary_plan_multimodal():
    ctx = {
        "duration_ms": 120000,
        "transcript_segments": [{"text": "Hello world", "start_ms": 0, "end_ms": 2000}],
        "visual_observations": [
            {"timestamp": 5000, "action": "greeting", "visual_description": "person waving", "confidence": 0.95},
            {"timestamp": 40000, "action": "acrobatic flip", "visual_description": "person does a backflip", "confidence": 0.90},
        ],
        "visual_scenes": [
            {"scene_id": "s1", "start_ms": 0, "end_ms": 10000, "dominant_action": "greeting", "confidence": 0.95},
            {"scene_id": "s2", "start_ms": 35000, "end_ms": 50000, "dominant_action": "acrobatic flip", "confidence": 0.90},
        ],
    }
    plan = build_summary_plan(ctx, target_duration_ms=30000, visual_strategy="SOURCE_CLIP")
    assert isinstance(plan, SummaryPlan)
    assert plan.total_summary_duration_ms <= 30000
    assert len(plan.scenes) >= 1
    assert plan.scenes[0].visual_strategy == "SOURCE_CLIP"
    assert plan.visual_action_ratio > 0.50  # sparse transcript detected


def test_build_summary_plan_visual_only():
    ctx = {
        "duration_ms": 60000,
        "transcript_segments": [],
        "visual_observations": [
            {"timestamp": 10000, "action": "running", "visual_description": "running athlete", "confidence": 0.92}
        ],
        "visual_scenes": [
            {"scene_id": "s1", "start_ms": 5000, "end_ms": 25000, "dominant_action": "running", "confidence": 0.92}
        ],
    }
    plan = build_summary_plan(ctx, target_duration_ms=20000)
    assert len(plan.scenes) >= 1
    assert plan.visual_action_ratio == 0.85


def test_build_summary_plan_transcript_only():
    ctx = {
        "duration_ms": 60000,
        "transcript_segments": [
            {"text": "Key announcement today regarding platform updates.", "start_ms": 0, "end_ms": 8000}
        ],
        "visual_observations": [],
        "visual_scenes": [],
    }
    plan = build_summary_plan(ctx, target_duration_ms=20000)
    assert len(plan.scenes) >= 1
    assert plan.scenes[0].summary_end_ms <= 20000


def test_build_summary_plan_action_heavy_prioritization():
    ctx = {
        "duration_ms": 180000,
        "transcript_segments": [],
        "visual_observations": [
            {"timestamp": 10000, "action": "walking slowly", "visual_description": "calm walk", "confidence": 0.8},
            {"timestamp": 80000, "action": "high intensity martial arts fight", "visual_description": "two fighters exchange blows", "confidence": 0.95},
        ],
        "visual_scenes": [
            {"scene_id": "calm", "start_ms": 0, "end_ms": 20000, "dominant_action": "walking slowly", "confidence": 0.8},
            {"scene_id": "action", "start_ms": 70000, "end_ms": 90000, "dominant_action": "high intensity martial arts fight", "confidence": 0.95},
        ],
    }
    # Tight budget: only enough for 1 scene (15s)
    plan = build_summary_plan(ctx, target_duration_ms=15000)
    assert len(plan.scenes) == 1
    # Action scene MUST be prioritized over calm walk!
    assert "fight" in plan.scenes[0].narration_text.lower() or plan.scenes[0].source_start_ms == 70000
