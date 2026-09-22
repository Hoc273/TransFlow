"""Option A+ calibration: per-binding CPS for SUMMARIZE and TRANSLATE pacing."""

from app.core.prompts import build_translate_prompt
from app.schemas.contract import (
    NarrativeIntentSlice,
    NarrativeSummarizeRequest,
    ProviderPayload,
    SttSegment,
)
from app.services import narrative_summarize_gateway
from app.services.narrative_planning_models import NarrativeDraft, WrittenSection
from app.services.summary.beat_grounding import narration_target_chars


def _request(cps=None) -> NarrativeSummarizeRequest:
    return NarrativeSummarizeRequest(
        correlation_id="corr-pacing",
        media_job_id="job-pacing",
        transcript=[SttSegment(text="Hello", start_ms=0, end_ms=60_000)],
        language="vi",
        duration_ms=60_000,
        intent=NarrativeIntentSlice(
            goal_type="SUMMARIZE_GENERATIVE",
            tone_style_hints=None,
            target_langs=["vi"],
        ),
        constraints=[],
        max_sections=5,
        target_duration_ms=60_000,
        provider=ProviderPayload(
            protocol="openai_compatible",
            base_url="https://provider.test/v1",
            api_key="sk-real-key",
            model="gpt-4o-mini",
        ),
        narration_cps_estimate=cps,
    )


def test_sixty_second_beat_uses_voice_cps_19():
    assert narration_target_chars(60_000, cps=19) == 1_140


def test_sixty_second_beat_default_stays_840():
    assert narration_target_chars(60_000) == 840


def test_three_hundred_second_target_budget_matches_piper_vi():
    assert narration_target_chars(300_000, cps=19) == 5_700


def test_writer_budget_normalizes_to_requested_duration_and_preserves_weights():
    allocated = [
        {
            "section_id": "S001",
            "blocks": [{"start_ms": 0, "end_ms": 100_000}],
        },
        {
            "section_id": "S002",
            "blocks": [{"start_ms": 100_000, "end_ms": 287_000}],
        },
    ]
    refs = {
        "S001": [(0, 100_000)],
        "S002": [(100_000, 287_000)],
    }

    pacing = narrative_summarize_gateway._narration_pacing_targets(
        allocated,
        refs,
        target_duration_ms=300_000,
        cps=20,
    )

    assert [item["presentation_span_ms"] for item in pacing] == [100_000, 187_000]
    assert [item["narration_target_ms"] for item in pacing] == [104_529, 195_471]
    assert sum(item["narration_target_ms"] for item in pacing) == 300_000
    assert sum(item["target_chars"] for item in pacing) == 6_000
    assert sum(item["target_chars"] for item in pacing) != 5_740
    assert all(item["normalized_to_requested"] for item in pacing)


def test_writer_budget_32_odd_millisecond_beats_preserves_aggregate_contract():
    spans = [8_969] * 31 + [8_961]
    allocated = []
    refs = {}
    start_ms = 0
    for index, span_ms in enumerate(spans, start=1):
        end_ms = start_ms + span_ms
        section_id = f"S{index:03d}"
        allocated.append(
            {
                "section_id": section_id,
                "blocks": [{"start_ms": start_ms, "end_ms": end_ms}],
            }
        )
        refs[section_id] = [(start_ms, end_ms)]
        start_ms = end_ms

    pacing = narrative_summarize_gateway._narration_pacing_targets(
        allocated,
        refs,
        target_duration_ms=300_000,
        cps=20,
    )
    aggregate_target_chars = sum(item["target_chars"] for item in pacing)

    assert start_ms == 287_000
    assert len(pacing) == 32
    assert sum(item["narration_target_ms"] for item in pacing) == 300_000
    assert aggregate_target_chars == 6_000
    assert all(item["normalized_to_requested"] for item in pacing)
    assert aggregate_target_chars * 1000 * 0.90 / 20 >= 270_000


def test_writer_budget_falls_back_to_presentation_span_without_target():
    allocated = [
        {
            "section_id": "S001",
            "blocks": [{"start_ms": 0, "end_ms": 100_000}],
        },
        {
            "section_id": "S002",
            "blocks": [{"start_ms": 100_000, "end_ms": 287_000}],
        },
    ]

    pacing = narrative_summarize_gateway._narration_pacing_targets(
        allocated,
        None,
        target_duration_ms=None,
        cps=20,
    )

    assert [item["narration_target_ms"] for item in pacing] == [100_000, 187_000]
    assert [item["target_chars"] for item in pacing] == [2_000, 3_740]
    assert not any(item["normalized_to_requested"] for item in pacing)


def test_effective_cps_prefers_request_hint():
    assert narrative_summarize_gateway._effective_narration_cps(_request(cps=19)) == 19


def test_effective_cps_defaults_to_global_14():
    assert narrative_summarize_gateway._effective_narration_cps(_request()) == 14


def test_diagnostics_use_same_effective_cps():
    draft = NarrativeDraft(
        sections=[WrittenSection(section_id="S001", script_source_lang="x" * 1_140)]
    )
    allocated = [{"section_id": "S001", "target_chars": 1_140}]
    diagnostics = narrative_summarize_gateway._narration_pacing_diagnostics(
        draft, allocated, correlation_id="corr-pacing", cps=19
    )
    assert diagnostics[0]["pacing_status"] == "WITHIN_ESTIMATE"
    assert diagnostics[0]["predicted_duration_ms"] == 60_000
    assert not narrative_summarize_gateway._pacing_needs_repair(diagnostics)


def test_translate_prompt_renders_initial_pacing_block():
    _system, user = build_translate_prompt(
        "en",
        "vi",
        "Source narration",
        [],
        [],
        {
            "domain": "narrative",
            "generative_tts_pacing": {
                "section_id": "S001",
                "target_tts_duration_ms": 60_000,
                "estimated_target_chars_per_second": 19,
                "target_chars_estimate": 1_140,
            },
        },
    )
    assert "<generative_tts_pacing>" in user
    assert '<metric name="section_id">S001</metric>' in user
    assert '<metric name="target_tts_duration_ms">60000</metric>' in user
    assert '<metric name="estimated_target_chars_per_second">19</metric>' in user
    assert '<metric name="target_chars_estimate">1140</metric>' in user
    assert "cold-start estimate" in user
    assert "Measured TTS duration remains authoritative" in user
    assert "<generative_tts_feedback>" not in user
    assert "generative_tts_pacing=\"" not in user
