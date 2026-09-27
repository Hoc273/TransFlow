"""Measured-TTS repair context must reach translation without changing the wire contract."""

from app.core.prompts import build_translate_prompt


def test_measured_tts_feedback_preserves_identity_and_duration_metrics():
    _system, user = build_translate_prompt(
        "vi",
        "vi",
        "Nguồn văn bản",
        [],
        [],
        {
            "domain": "narrative",
            "generative_tts_feedback": {
                "section_id": "S001",
                "story_arc": "HOOK",
                "source_refs": "[{\"start_ms\":10,\"end_ms\":2000}]",
                "requested_target_tts_duration_ms": 300000,
                "allowed_min_tts_duration_ms": 270000,
                "allowed_max_tts_duration_ms": 330000,
                "repair_aim_tts_duration_ms": 315000,
                "repair_direction": "EXPAND",
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
    assert '<metric name="requested_target_tts_duration_ms">300000</metric>' in user
    assert '<metric name="allowed_min_tts_duration_ms">270000</metric>' in user
    assert '<metric name="allowed_max_tts_duration_ms">330000</metric>' in user
    assert '<metric name="repair_aim_tts_duration_ms">315000</metric>' in user
    assert '<metric name="repair_direction">EXPAND</metric>' in user
    assert '<metric name="measured_tts_duration_ms">120000</metric>' in user
    assert '<metric name="target_tts_duration_ms">300000</metric>' in user
    assert '<metric name="target_chars_estimate">5925</metric>' in user
    assert "accepted duration window" in user
    assert "Keep the same section identity" in user
    assert "Rewrite only with facts supported by the source text" in user
    assert "Aim for the target duration using the observed target-language speaking rate" in user
    assert '<context domain="narrative"/>' in user
    assert "generative_tts_feedback=\"" not in user


def test_initial_tts_pacing_contains_target_and_acceptable_band_contract():
    _system, user = build_translate_prompt(
        "en",
        "vi",
        "Locked source evidence",
        [],
        [],
        {
            "domain": "narrative",
            "generative_tts_pacing": {
                "section_id": "S002",
                "target_tts_duration_ms": 6000,
                "estimated_target_chars_per_second": 20,
                "target_chars_estimate": 120,
                "acceptable_lower_chars": 108,
                "acceptable_upper_chars": 132,
            },
        },
    )

    assert "<generative_tts_pacing>" in user
    assert '<metric name="target_chars_estimate">120</metric>' in user
    assert '<metric name="acceptable_lower_chars">108</metric>' in user
    assert '<metric name="acceptable_upper_chars">132</metric>' in user
    assert "must stay inside the acceptable character band" in user
    assert "do not compress it into a short summary" in user
    assert "do not invent details" in user


def test_translate_prompt_uses_descriptive_language_labels_and_dialogue_rule():
    system, _user = build_translate_prompt(
        "zh",
        "vi",
        "Short source dialogue",
        [],
        [],
        None,
    )

    assert "from Chinese (中文, code: zh) to Vietnamese (tiếng Việt, code: vi)" in system
    assert "entirely in Vietnamese (tiếng Việt, code: vi)" in system
    assert "Short dialogue, slang, memes, interjections, and sound effects are not exceptions" in system
    assert "Translate or naturally adapt them into Vietnamese (tiếng Việt, code: vi)" in system
    assert "Do not copy source-language script as the translation merely because the phrase is short or idiomatic" in system


def test_language_labels_keep_locale_codes_and_unknown_codes_open():
    localized_system, _user = build_translate_prompt(
        "zh-CN",
        "vi-VN",
        "Localized source",
        [],
        [],
        None,
    )
    unknown_system, _unknown_user = build_translate_prompt(
        "xx",
        "xx",
        "Unknown source",
        [],
        [],
        None,
    )

    assert "Chinese (中文, code: zh-CN)" in localized_system
    assert "Vietnamese (tiếng Việt, code: vi-VN)" in localized_system
    assert "from xx to xx" in unknown_system


def test_target_language_correction_edits_current_text_in_place():
    _system, user = build_translate_prompt(
        "en",
        "vi",
        "Locked source evidence",
        [],
        [],
        {
            "domain": "narrative",
            "generative_tts_correction": {
                "section_id": "S004",
                "current_target_text": "Bản dịch hiện tại cần được mở rộng.",
                "actual_target_chars": 38,
                "target_chars_estimate": 120,
                "acceptable_lower_chars": 108,
                "acceptable_upper_chars": 132,
                "deficit_chars": 82,
                "overage_chars": 0,
                "target_tts_duration_ms": 6000,
                "measured_tts_duration_ms": 3900,
                "observed_target_chars_per_second": 10.0,
                "repair_aim_tts_duration_ms": 6000,
            },
        },
    )

    assert "<generative_tts_correction>" in user
    assert "<current_target_text>Bản dịch hiện tại cần được mở rộng.</current_target_text>" in user
    assert '<metric name="actual_target_chars">38</metric>' in user
    assert '<metric name="acceptable_lower_chars">108</metric>' in user
    assert "edit it in place" in user
    assert "do not restart translation with a shorter summary" in user
    assert '<context generative_tts_correction=' not in user


def test_target_language_correction_freshly_retranslates_rejected_text_and_keeps_pacing_context():
    system, user = build_translate_prompt(
        "zh",
        "vi",
        "中文 source grounding",
        [],
        [],
        {
            "target_language_correction": {
                "target_lang": "vi",
                "incompatible_script": "HAN",
                "incompatible_ratio": 1.0,
                "current_target_text": "这是当前错误的目标文本。",
            },
            "generative_tts_pacing": {
                "target_chars_estimate": 120,
                "acceptable_lower_chars": 108,
                "acceptable_upper_chars": 132,
            },
            "generative_tts_feedback": {
                "target_chars_estimate": 120,
                "measured_tts_duration_ms": 5500,
            },
        },
    )

    assert "from Chinese (中文, code: zh) to Vietnamese (tiếng Việt, code: vi)" in system
    assert "entirely in Vietnamese (tiếng Việt, code: vi)" in system
    assert "<target_language_correction>" in user
    assert "<target_lang>vi</target_lang>" in user
    assert "<incompatible_script>HAN</incompatible_script>" in user
    assert "<incompatible_ratio>1.0</incompatible_ratio>" in user
    assert "<current_target_text>这是当前错误的目标文本。</current_target_text>" in user
    assert "previous target candidate was rejected" in user
    assert "Translate the source text again from scratch into Vietnamese (tiếng Việt, code: vi)" in user
    assert "Do not copy, preserve, or rephrase incompatible-script wording" in user
    assert "<generative_tts_pacing>" in user
    assert "<generative_tts_feedback>" in user


def test_qa_prompt_preserves_source_span_and_target_language_contract():
    from app.core.prompts import build_qa_prompt

    system, user = build_qa_prompt(
        "zh",
        "vi",
        "这是 source excerpt。",
        "Đây là bản dịch.",
        [],
        ["grammar", "fluency"],
    )

    assert "source_span must be a verbatim excerpt" in system
    assert "may therefore be in the source language (including Chinese)" in system
    assert "target_span must be a verbatim excerpt" in system
    assert "suggestion must be replacement text in vi" in system
    assert "message must be written in vi" in system
    assert "<source_text>这是 source excerpt。</source_text>" in user
