"""Measured-TTS repair context must reach translation without changing the wire contract."""

from app.core.prompts import build_translate_prompt


def test_measured_tts_feedback_preserves_identity_and_duration_metrics():
    _system, user = build_translate_prompt(
        "vi",
        "vi",
        "Nguồn văn bản",
        [],
        {
            "domain": "narrative",
            "generative_tts_feedback": {
                "section_id": "S001",
                "story_arc": "HOOK",
                "source_refs": "[{\"start_ms\":10,\"end_ms\":2000}]",
                "measured_tts_duration_ms": 120000,
                "target_tts_duration_ms": 300000,
                "duration_deficit_ms": 180000,
                "observed_target_chars_per_second": 19.75,
                "target_chars_estimate": 5925,
            },
        },
    )

    assert "<generative_tts_feedback>" in user
    assert '<metric name="section_id">S001</metric>' in user
    assert '<metric name="story_arc">HOOK</metric>' in user
    assert '<metric name="source_refs">[{"start_ms":10,"end_ms":2000}]</metric>' in user
    assert '<metric name="measured_tts_duration_ms">120000</metric>' in user
    assert '<metric name="target_tts_duration_ms">300000</metric>' in user
    assert "Keep the same section identity" in user
    assert "Rewrite only with facts supported by the source text" in user
    assert "Aim for the target duration using the observed target-language speaking rate" in user
    assert '<context domain="narrative"/>' in user
    assert "generative_tts_feedback=\"" not in user
