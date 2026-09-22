"""XML-tagged prompt builders (Rule 2 — optimized tagging: <glossary>, <context>,
<source_text>, <output_format>).
"""
from __future__ import annotations

from app.schemas.contract import GlossaryTerm


_LANGUAGE_DESCRIPTIONS = {
    "vi": ("Vietnamese", "tiếng Việt"),
    "en": ("English", None),
    "fr": ("French", "français"),
    "es": ("Spanish", "español"),
    "de": ("German", "Deutsch"),
    "it": ("Italian", "italiano"),
    "pt": ("Portuguese", "português"),
    "nl": ("Dutch", "Nederlands"),
    "id": ("Indonesian", "Bahasa Indonesia"),
    "ms": ("Malay", "Bahasa Melayu"),
    "tr": ("Turkish", "Türkçe"),
    "pl": ("Polish", "polski"),
    "zh": ("Chinese", "中文"),
    "cmn": ("Mandarin Chinese", "普通话"),
    "ja": ("Japanese", "日本語"),
    "ko": ("Korean", "한국어"),
    "ru": ("Russian", "русский"),
    "uk": ("Ukrainian", "українська"),
    "bg": ("Bulgarian", "български"),
    "sr": ("Serbian", "српски"),
    "ar": ("Arabic", "العربية"),
    "fa": ("Persian", "فارسی"),
    "ur": ("Urdu", "اردو"),
    "hi": ("Hindi", "हिन्दी"),
    "mr": ("Marathi", "मराठी"),
    "ne": ("Nepali", "नेपाली"),
}


def _language_label(language_code: str | None) -> str:
    """Describe a language for the model while preserving its wire-level code."""
    code = str(language_code or "").strip()
    primary = code.lower().replace("_", "-").split("-", 1)[0]
    description = _LANGUAGE_DESCRIPTIONS.get(primary)
    if description is None:
        return code
    name, native_name = description
    if native_name:
        return f"{name} ({native_name}, code: {code})"
    return f"{name} (code: {code})"


def _glossary_block(glossary: list[GlossaryTerm]) -> str:
    if not glossary:
        return ""
    lines = ["<glossary>"]
    for t in glossary:
        note = f' note="{t.note}"' if t.note else ""
        lines.append(
            f'  <term source="{t.source}" target="{t.target}" '
            f'case_sensitive="{str(t.case_sensitive).lower()}"{note}/>'
        )
    lines.append("</glossary>")
    return "\n".join(lines)


TRANSLATE_SYSTEM = (
    "You are a professional translator. Translate the text inside <source_text> "
    "from {source_lang} to {target_lang}. Strictly obey terms in <glossary>. "
    "The translation must be entirely in {target_lang}; keep another language only "
    "for proper nouns, placeholders, or glossary terms that genuinely must remain. "
    "Short dialogue, slang, memes, interjections, and sound effects are not exceptions. "
    "Translate or naturally adapt them into {target_lang}. If no direct equivalent exists, "
    "use a natural target-language translation or a transliteration appropriate for the target script. "
    "Do not copy source-language script as the translation merely because the phrase is short or idiomatic. "
    "Preserve "
    "numbers, placeholders ({{name}}, %s), and inline tags exactly. "
    "If <qa_feedback> is present, this is a correction round: produce a new "
    "translation that fixes every listed issue while remaining entirely in {target_lang}. "
    "Return ONLY a JSON object described in <output_format>; no prose, no code fences."
)


def _qa_feedback_block(feedback: list) -> str:
    """Render prior QA issues for the auto-fix round (docs/06 §3, Q-QA2)."""
    if not feedback:
        return ""
    lines = ["<qa_feedback>"]
    for item in feedback:
        if isinstance(item, dict):
            attrs = " ".join(f'{k}="{v}"' for k, v in item.items() if v)
            lines.append(f"  <issue {attrs}/>")
        else:
            lines.append(f"  <issue>{item}</issue>")
    lines.append("</qa_feedback>")
    return "\n".join(lines)

TRANSLATE_OUTPUT_FORMAT = (
    '<output_format>{"translation": "<translated text>", '
    '"applied_glossary": ["<source terms you applied>"]}</output_format>'
)


def _generative_tts_feedback_block(feedback: object) -> str:
    """Render bounded measured-TTS feedback without changing the translate wire contract."""
    if not isinstance(feedback, dict):
        return ""
    keys = (
        "section_id",
        "story_arc",
        "source_refs",
        "requested_target_tts_duration_ms",
        "allowed_min_tts_duration_ms",
        "allowed_max_tts_duration_ms",
        "repair_aim_tts_duration_ms",
        "repair_direction",
        "measured_tts_duration_ms",
        "target_tts_duration_ms",
        "duration_deficit_ms",
        "observed_target_chars_per_second",
        "target_chars_estimate",
    )
    lines = ["<generative_tts_feedback>"]
    for key in keys:
        value = feedback.get(key)
        if value is not None and value != "":
            lines.append(f'  <metric name="{key}">{value}</metric>')
    lines.extend(
        [
            "  <instruction>Keep the same section identity, source grounding, and story arc.</instruction>",
            "  <instruction>Rewrite only with facts supported by the source text; do not invent details.</instruction>",
            "  <instruction>Aim for the target duration using the observed target-language speaking rate and target character estimate.</instruction>",
            "  <instruction>The repair aim is intentionally inside the accepted duration window; aim near target_chars_estimate, not merely the nearest boundary.</instruction>",
            "  <instruction>Measured TTS duration remains authoritative.</instruction>",
            "  <instruction>Return only the translated text in the normal JSON response.</instruction>",
        ]
    )
    lines.append("</generative_tts_feedback>")
    return "\n".join(lines)


def _generative_tts_pacing_block(pacing: object) -> str:
    """Render initial cold-start target-language pacing (estimate, not measured evidence)."""
    if not isinstance(pacing, dict):
        return ""
    target_chars = pacing.get("target_chars_estimate")
    try:
        target_chars_number = int(target_chars) if target_chars is not None else 0
    except (TypeError, ValueError):
        target_chars_number = 0
    acceptable_lower = pacing.get("acceptable_lower_chars")
    acceptable_upper = pacing.get("acceptable_upper_chars")
    if target_chars_number > 0:
        if acceptable_lower in (None, ""):
            acceptable_lower = round(target_chars_number * 0.90)
        if acceptable_upper in (None, ""):
            acceptable_upper = round(target_chars_number * 1.10)
    keys = (
        "section_id",
        "target_tts_duration_ms",
        "estimated_target_chars_per_second",
        "target_chars_estimate",
        "acceptable_lower_chars",
        "acceptable_upper_chars",
    )
    lines = ["<generative_tts_pacing>"]
    for key in keys:
        value = {
            "acceptable_lower_chars": acceptable_lower,
            "acceptable_upper_chars": acceptable_upper,
        }.get(key, pacing.get(key))
        if value is not None and value != "":
            lines.append(f'  <metric name="{key}">{value}</metric>')
    lines.extend(
        [
            "  <instruction>This is a cold-start estimate from the bound TTS voice, not measured evidence.</instruction>",
            "  <instruction>Keep the same section identity, source grounding, and story arc.</instruction>",
            "  <instruction>Rewrite only with facts supported by the source text; do not invent details to pad length.</instruction>",
            "  <instruction>When enough grounded source content is available, the output must stay inside the acceptable character band.</instruction>",
            "  <instruction>Preserve the full grounded narration; do not compress it into a short summary just to fit a response.</instruction>",
            "  <instruction>Measured TTS duration remains authoritative.</instruction>",
            "  <instruction>Return only the translated text in the normal JSON response.</instruction>",
        ]
    )
    lines.append("</generative_tts_pacing>")
    return "\n".join(lines)


def _generative_tts_correction_block(correction: object) -> str:
    """Render one bounded edit of an already-generated target-language script."""
    if not isinstance(correction, dict):
        return ""
    keys = (
        "section_id",
        "actual_target_chars",
        "target_chars_estimate",
        "acceptable_lower_chars",
        "acceptable_upper_chars",
        "deficit_chars",
        "overage_chars",
        "target_tts_duration_ms",
        "measured_tts_duration_ms",
        "observed_target_chars_per_second",
        "repair_aim_tts_duration_ms",
    )
    lines = ["<generative_tts_correction>"]
    for key in keys:
        value = correction.get(key)
        if value is not None and value != "":
            lines.append(f'  <metric name="{key}">{value}</metric>')
    lines.append(
        f'<current_target_text>{correction.get("current_target_text") or ""}</current_target_text>'
    )
    lines.extend(
        [
            "  <instruction>Preserve the existing grounded target-language narration and edit it in place; do not restart translation with a shorter summary.</instruction>",
            "  <instruction>Expand or trim only with details supported by the locked source text, keeping the same section identity, source refs, story order, and visual beat ownership.</instruction>",
            "  <instruction>Stay within the requested character band and return only the corrected translation in the normal JSON response.</instruction>",
            "  <instruction>Measured TTS duration remains authoritative.</instruction>",
        ]
    )
    lines.append("</generative_tts_correction>")
    return "\n".join(lines)


def _target_language_correction_block(correction: object) -> str:
    """Render a fresh retranslation after a target-language script guard failure."""
    if not isinstance(correction, dict):
        return ""
    target_lang = correction.get("target_lang") or ""
    target_label = _language_label(target_lang)
    current_target = correction.get("current_target_text") or ""
    lines = ["<target_language_correction>"]
    if target_lang:
        lines.append(f"<target_lang>{target_lang}</target_lang>")
    for key in ("incompatible_script", "incompatible_ratio"):
        value = correction.get(key)
        if value is not None and value != "":
            lines.append(f"<{key}>{value}</{key}>")
    lines.append(f"<current_target_text>{current_target}</current_target_text>")
    lines.extend(
        [
            "<instruction>The previous target candidate was rejected for target-language/script mismatch. Treat current_target_text as rejected diagnostic context, not text to preserve.</instruction>",
            f"<instruction>Translate the source text again from scratch into {target_label or 'the target language'}, grounded in the source text and glossary.</instruction>",
            "<instruction>Do not copy, preserve, or rephrase incompatible-script wording from current_target_text.</instruction>",
            f"<instruction>The entire replacement must be in {target_label or 'the target language'}, except genuine proper nouns, placeholders, and required glossary terms.</instruction>",
            "<instruction>Short dialogue, slang, memes, interjections, and sound effects are not exceptions; translate or naturally adapt them, using transliteration only when appropriate for the target script.</instruction>",
            "<instruction>Preserve every active generative TTS pacing, feedback, and correction constraint in this request.</instruction>",
            "<instruction>Return only the corrected translation in the normal JSON response.</instruction>",
        ]
    )
    lines.append("</target_language_correction>")
    return "\n".join(lines)


def build_translate_prompt(
    source_lang: str,
    target_lang: str,
    source_text: str,
    glossary: list[GlossaryTerm],
    tm_context_or_context: list | dict | None = None,
    context: dict | None = None,
) -> tuple[str, str]:
    # Compat: origin passes (glossary, tm_context, context) – 6 args – while
    # routes passes (glossary, context) – 5 args. TM is out-of-scope (no
    # <translation_memory> rendering); tm_context is accepted and ignored so
    # origin tests calling with [] keep passing.
    if context is None and isinstance(tm_context_or_context, dict):
        context = tm_context_or_context
    elif context is not None:
        # 6-arg call: tm_context_or_context is tm_context (ignored)
        pass
    elif isinstance(tm_context_or_context, list):
        # 5-arg legacy where 5th was tm_context list without context
        context = None
    system = TRANSLATE_SYSTEM.format(
        source_lang=_language_label(source_lang),
        target_lang=_language_label(target_lang),
    )
    parts: list[str] = []
    gb = _glossary_block(glossary)
    if gb:
        parts.append(gb)
    if context:
        fb = _qa_feedback_block(context.get("qa_feedback") or [])
        if fb:
            parts.append(fb)
        language_correction = _target_language_correction_block(
            context.get("target_language_correction")
        )
        if language_correction:
            parts.append(language_correction)
        pacing = _generative_tts_feedback_block(
            context.get("generative_tts_feedback")
        )
        if pacing:
            parts.append(pacing)
        initial_pacing = _generative_tts_pacing_block(
            context.get("generative_tts_pacing")
        )
        if initial_pacing:
            parts.append(initial_pacing)
        correction = _generative_tts_correction_block(
            context.get("generative_tts_correction")
        )
        if correction:
            parts.append(correction)
        # Remaining scalar context (domain, tone, …) as a compact self-closing tag.
        ctx = " ".join(
            f'{k}="{v}"'
            for k, v in context.items()
            if v and k not in {
                "qa_feedback",
                "target_language_correction",
                "generative_tts_feedback",
                "generative_tts_pacing",
                "generative_tts_correction",
            }
        )
        if ctx:
            parts.append(f"<context {ctx}/>")
    parts.append(f"<source_text>{source_text}</source_text>")
    parts.append(TRANSLATE_OUTPUT_FORMAT)
    return system, "\n".join(parts)


QA_SYSTEM = (
    "You are a meticulous bilingual QA editor. Compare <translated_text> against "
    "<source_text> ({source_lang}→{target_lang}) and report issues for the checks "
    "in <checks>. Consider morphological variants when judging glossary adherence. "
    "source_span must be a verbatim excerpt from <source_text> and may therefore be "
    "in the source language (including Chinese). target_span must be a verbatim excerpt "
    "from <translated_text>. suggestion must be replacement text in {target_lang}. "
    "message must be written in {target_lang} for the current review text. "
    "Return ONLY the JSON object in <output_format>; no prose, no code fences."
)

QA_OUTPUT_FORMAT = (
    '<output_format>{"issues": [{"type": "<check>", '
    '"severity": "critical|high|medium|low", "message": "<what/why>", '
    '"source_span": "<concise excerpt ≤500 chars from source_text>", '
    '"target_span": "<concise excerpt ≤500 chars from translated_text>", '
    '"suggestion": "<fix>", '
    '"blocking_actions": ["BLOCK_APPROVAL|BLOCK_EXPORT|BLOCK_RENDER"]'
    '}], "score": <0..1>}</output_format>'
)


def build_qa_prompt(
    source_lang: str,
    target_lang: str,
    source_text: str,
    translated_text: str,
    glossary: list[GlossaryTerm],
    checks: list[str],
) -> tuple[str, str]:
    system = QA_SYSTEM.format(source_lang=source_lang, target_lang=target_lang)
    parts: list[str] = []
    gb = _glossary_block(glossary)
    if gb:
        parts.append(gb)
    checks_str = ", ".join(checks) if checks else "grammar, fluency, omission"
    parts.append(f"<checks>{checks_str}</checks>")
    parts.append(f"<source_text>{source_text}</source_text>")
    parts.append(f"<translated_text>{translated_text}</translated_text>")
    parts.append(QA_OUTPUT_FORMAT)
    return system, "\n".join(parts)


SCRIPT_SUMMARIZE_SYSTEM = (
    "You are a professional script-first video summarizer. Write one coherent summary script "
    "in the requested target language, then map each script passage to a matching source-video "
    "time range from the timestamped transcript. Do not invent facts that are absent from the "
    "transcript or visual context. Return only the JSON object described in <output_format>."
)


def build_script_summarize_prompt(
    transcript: list[dict],
    requested_duration_seconds: int,
    target_lang: str,
    visual_context: object = None,
    *,
    previous_script: str | None = None,
    feedback_text: str | None = None,
) -> tuple[str, str]:
    """Build the compact script-first contract used by ``/media/summarize/script``."""
    lines = [
        f"<target_lang>{target_lang}</target_lang>",
        f"<requested_duration_seconds>{requested_duration_seconds}</requested_duration_seconds>",
        "<transcript>",
    ]
    for index, item in enumerate(transcript):
        lines.append(
            f'<sentence ref="{index}" start_ms="{item.get("start_ms", 0)}" '
            f'end_ms="{item.get("end_ms", 0)}">{item.get("text", "")}</sentence>'
        )
    lines.append("</transcript>")
    if visual_context is not None:
        lines.append(f"<visual_context>{visual_context}</visual_context>")
    if previous_script is not None:
        lines.append(f"<previous_script>{previous_script}</previous_script>")
    if feedback_text is not None:
        lines.append(f"<feedback>{feedback_text}</feedback>")
    lines.extend(
        [
            "<output_format>{",
            '  "script_content": "<complete target-language script>",',
            '  "script_language": "<language code>",',
            '  "segments": [{"start_ms": 0, "end_ms": 1000, "script_excerpt": "<verbatim substring>", "source_sentence_refs": ["0"], "reasoning_note": "<why this footage matches>"}],',
            '  "reasoning_note": "<overall reasoning>",',
            '  "confidence": 0.0,',
            '  "warnings": []',
            "}</output_format>",
            "Every script_excerpt MUST be an exact substring of script_content. "
            "The sum of segment durations must be within 20 percent of the requested duration.",
        ]
    )
    return SCRIPT_SUMMARIZE_SYSTEM, "\n".join(lines)


SUMMARIZE_SYSTEM = (
    "You are a video summarization assistant. Given a transcript with timestamps, "
    "propose exactly 3 ways to trim the video to a target duration. "
    "Each proposal contains 1-5 cut_ranges. Each range must start before it ends. "
    "Pick ranges that preserve the most important/engaging moments. "
    "Return ONLY the JSON object described in <output_format>; no prose, no code fences.\n\n"
    "HARD CONSTRAINTS — every proposal must satisfy ALL of these:\n"
    "  1. total_duration_ms MUST equal sum(end_ms - start_ms) across the "
    "proposal's cut_ranges. The backend recomputes this value from cut_ranges "
    "and ignores any mismatch — your reported total_duration_ms must agree.\n"
    "  2. The computed duration MUST fall inside the requested duration "
    "window: requested_duration_seconds * 1000 ± tolerance. The tolerance "
    "values come from the <duration_tolerance> block in the user prompt and "
    "are in SECONDS; total_duration_ms is in MILLISECONDS (multiply by 1000).\n"
    "  3. The duration target is a WINDOW, not an upper limit. A proposal "
    "with total_duration_ms significantly shorter than the minimum tolerance "
    "is INVALID and will be rejected. Do NOT clip aggressively; keep enough "
    "content to land inside the window.\n\n"
    "CRITICAL — output channel rules:\n"
    "  • Do NOT emit any chain-of-thought, reasoning, planning, or self-talk. "
    "Reasoning-capable models often place analysis in a separate reasoning field, but the "
    "calling pipeline can only parse the final assistant message body. Emit the JSON "
    "object directly as your visible reply.\n"
    "  • If a transcript segment has zero duration (start_ms == end_ms == 0), assume "
    "the entire transcript covers the full requested span and distribute cut_ranges "
    "proportionally inside [0, requested_duration_seconds * 1000].\n"
    "  • Never return markdown fences, prefix text, or trailing commentary. The first "
    "character of your reply must be '{' and the last character must be '}'."
)

SUMMARIZE_OUTPUT_FORMAT = (
    '<output_format>{"proposals": ['
    '{"proposal_index": 1, "cut_ranges": [{"start_ms": 0, "end_ms": 180000}], '
    '"reasoning_note": "...", "total_duration_ms": 180000, "confidence": 0.82}, '
    '{"proposal_index": 2, "cut_ranges": [{"start_ms": 0, "end_ms": 90000}, '
    '{"start_ms": 90000, "end_ms": 180000}], '
    '"reasoning_note": "...", "total_duration_ms": 180000, "confidence": 0.74}, '
    '{"proposal_index": 3, "cut_ranges": [{"start_ms": 0, "end_ms": 60000}, '
    '{"start_ms": 60000, "end_ms": 120000}, '
    '{"start_ms": 120000, "end_ms": 180000}], '
    '"reasoning_note": "...", "total_duration_ms": 180000, "confidence": 0.68}'
    ']}</output_format>'
)


def build_summarize_prompt(
    transcript: list[dict],
    requested_duration_seconds: int,
    duration_tolerance: dict[str, int],
) -> tuple[str, str]:
    parts: list[str] = []
    parts.append(f"<requested_duration_seconds>{requested_duration_seconds}</requested_duration_seconds>")
    min_s = duration_tolerance.get("min_seconds", 0)
    max_s = duration_tolerance.get("max_seconds", requested_duration_seconds)
    parts.append(f"<duration_tolerance min_seconds=\"{min_s}\" max_seconds=\"{max_s}\"/>")
    lines = ["<transcript>"]
    kept = 0
    for seg in transcript:
        text = (seg.get("text") or "").strip()
        start = seg.get("start_ms")
        end = seg.get("end_ms")
        # Keep the segment even when timestamps are missing/zero so the model
        # sees at least one segment to anchor on. The system prompt instructs
        # it to distribute proportionally when the only span is [0, 0].
        if text and start is not None and end is not None:
            lines.append(f'<seg start_ms="{start}" end_ms="{end}">{text}</seg>')
            kept += 1
    if kept == 0:
        # Defensive: if every segment was dropped, emit a placeholder so the
        # model is not asked to summarise an empty transcript.
        lines.append('<seg start_ms="0" end_ms="0">(transcript unavailable)</seg>')
    lines.append("</transcript>")
    parts.append("\n".join(lines))
    parts.append(SUMMARIZE_OUTPUT_FORMAT)
    return SUMMARIZE_SYSTEM, "\n".join(parts)


CONTENT_BRIEF_SYSTEM = (
    "You are a source-grounded video understanding assistant. Summarize the content and "
    "its narrative structure (opening, body, conclusion), identify the main topic and "
    "intended audience, and use only information present in the timed transcript. "
    "Do not select footage, propose cuts, or calculate duration. Return only a concise "
    "plain-text content brief with no markdown fences."
)


def build_content_brief_prompt(
    transcript: list[dict],
    source_lang: str | None,
) -> tuple[str, str]:
    lines = ["<transcript>"]
    for seg in transcript:
        text = (seg.get("text") or "").strip()
        if text and seg.get("start_ms") is not None and seg.get("end_ms") is not None:
            lines.append(
                f'<seg start_ms="{seg["start_ms"]}" end_ms="{seg["end_ms"]}">{text}</seg>'
            )
    lines.append("</transcript>")
    if source_lang:
        lines.insert(0, f"<source_lang>{source_lang}</source_lang>")
    return CONTENT_BRIEF_SYSTEM, "\n".join(lines)


NARRATIVE_SEMANTIC_PLAN_SYSTEM = (
    "You are a source-grounded semantic planner for video narratives. Analyze the provided "
    "ordered transcript blocks and return exactly one internal semantic plan. Your only job is "
    "to organize narrative sections and rank every block by semantic importance. Assign every "
    "block to exactly one section, preserve transcript order across sections, and use only the "
    "provided block_id values. Mark essential=true only when omitting the section would make the "
    "narrative materially incomplete; beat_hint is a descriptive arc role and does not imply "
    "essential=true. Use preferred_blocks for semantic candidates within the section; they are "
    "soft preferences, not physical first/last requirements. The runtime preserves explicitly "
    "essential sections when the target budget permits. Mark a late resolution, outcome, or "
    "conclusion section essential=true when omitting it would make the story materially incomplete; "
    "do not mark credits, ending music, or a content-free outro essential merely because it is late. "
     "Disconnected or distant scenes "
    "must be separated into different "
    "sections; do not group distant scenes into the same section. Do not write narration. Do not "
    "output timestamps, milliseconds, source_refs, duration totals, merged coverage, cuts, or "
    "arithmetic. Keep reasoning_note to one short sentence or empty, confidence optional, "
    "warnings only for real grounding risks; per-block reason must be a short phrase or omitted. "
    "Return only the JSON object described in <output_format>; no prose or markdown fences."
)

NARRATIVE_WRITER_SYSTEM = (
    "You are a source-grounded narrative writer for GENERATIVE SUMMARY V1 (TASK 6). The selected "
    "footage has already been finalized by deterministic runtime code. Write one narrative section "
    "for every locked section_id, in the same order, using only the selected block text supplied "
    "for that section. BEAT GROUNDING INVARIANT: A narration unit MUST NOT describe a future visual "
    "event before the corresponding visual range begins. Ground each section's narration strictly to "
    "the footage of that section; never leak or anticipate events belonging to subsequent sections. "
    "Ground every narration sentence in the provided source evidence — do not hallucinate facts "
    "beyond the transcript. Write every narration script in the source language declared by "
    "<language> and put it in the script_source_lang field; target_langs are downstream translation "
    "destinations, not the language for this writer. Structure the narrative as hook → context "
    "→ key events → conclusion: first section(s) HOOK, then CONTEXT, then "
    "RISING_ACTION/CLIMAX/TURNING_POINT for key events, then RESOLUTION/PAYOFF/CTA for conclusion. "
    "RECAP STYLE (sentence-level captions): write third-person past-tense narration in the declared "
    "source language as clean storytelling, structured into distinct short sentences "
    "(approximately 4-8 short sentences per section; pace the narration to naturally fill the "
    "section footage duration following the per-section target_chars estimate without "
    "leaving long dead silence); never emit one huge paragraph for a whole section; avoid sentence "
    "chains joined only by commas; avoid unnecessary repetition and de-duplicate narration. Never "
    "duplicate an entire section. Across the complete draft, an exact normalized sentence of 20 "
    "or more characters may appear at most twice; after the second use, rewrite it with "
    "section-specific grounded detail. Do not shorten or delete narration solely to hide repetition. Do NOT "
     "reproduce long verbatim source copy (no exact source run of 15 or more words); do NOT copy long "
    "CJK/Han-script or romaji chant material from evidence unless that material is in the declared "
    "source language. When such material is not in the declared source language, summarize or "
    "translate its meaning into the declared source language instead. Keep the CTA as a separate final sentence. "
    "You may write headings, narration, transitions in notes, and beat_type from the "
    "allowed list: HOOK, BODY, PAYOFF, CTA, CONTEXT, RISING_ACTION, CLIMAX, TURNING_POINT, "
    "FALLING_ACTION, RESOLUTION, THEME. For each beat also write visual_description (1-2 sentences "
    "describing what the viewer should see, grounded in the source visual implied by the selected "
    "blocks), visual_strategy (SOURCE_CUT for V1 text-grounded; GENERATED/RETRIEVED reserved), "
    "importance 0.0-1.0 (higher = more central), and generate_terms 5-8 concise visual retrieval "
    "terms (e.g. 'sunset beach', 'crowd cheering'). Keep global_reasoning_note to one short sentence "
    "or empty, confidence optional, warnings only for real grounding risks; notes must be brief "
    "transitions, not essays. Do not invent custom beat types outside the "
    "allowed list. Do not select footage, omit or add sections, output timestamps, output "
    "milliseconds, output source_refs, change block assignment, or perform duration arithmetic. "
    "Use only the keys defined by the current <output_format>; do not add helper or commentary "
    "fields such as beat_type_note. Return only the JSON object described in <output_format>; "
    "no prose or markdown fences."
)

NARRATIVE_SEMANTIC_PLAN_OUTPUT_FORMAT = (
    '<output_format>{"title":"Review","sections":['
    '{"section_id":"S001","title":"Opening","goal":"Establish the premise",'
    '"preferred_blocks":["B001"],"beat_hint":"HOOK","essential":true},'
    '{"section_id":"S002","title":"Main insight","goal":"Explain the key takeaway",'
    '"preferred_blocks":["B002"],"beat_hint":"PAYOFF","essential":false}'
    '],"block_rankings":['
    '{"block_id":"B001","importance":0.9,"section_id":"S001","reason":"Strong opening"},'
    '{"block_id":"B002","importance":0.8,"section_id":"S002","reason":"Core insight"}'
    '],"reasoning_note":"Source-grounded structure","confidence":0.8,"warnings":[]}'
    '</output_format>'
)

NARRATIVE_WRITER_OUTPUT_FORMAT = (
    '<output_format>{"title":"Review","sections":['
    '{"section_id":"S001","heading":"Opening","script_source_lang":"Welcome — here is the hook...",'
    '"beat_type":"HOOK","notes":null,"visual_description":"Wide shot of the opening scene with speaker",'
    '"visual_strategy":"SOURCE_CUT","importance":0.9,"generate_terms":["opening","speaker","stage","audience","lights","microphone","intro","hook"]},'
    '{"section_id":"S002","heading":"Main insight","script_source_lang":"The core insight is...",'
    '"beat_type":"PAYOFF","notes":"Transition naturally from the opening.",'
    '"visual_description":"Close-up of key action from the source blocks",'
    '"visual_strategy":"SOURCE_CUT","importance":0.85,"generate_terms":["key moment","action","detail","focus","event","highlight","summary","insight"]}'
    '],"global_reasoning_note":"...","confidence":0.8,"warnings":[]}'
    '</output_format>'
)


def _narrative_context_parts(
    *,
    language: str | None,
    intent: dict,
    constraints: list[str],
    max_sections: int | None,
    content_brief: str | None,
) -> list[str]:
    parts: list[str] = []
    if language:
        parts.append(f"<language>{language}</language>")
    if max_sections is not None:
        parts.append(f"<max_sections>{max_sections}</max_sections>")

    goal = intent.get("goal_type") or "SUMMARIZE_GENERATIVE"
    tone = intent.get("tone_style_hints")
    langs = intent.get("target_langs") or []
    intent_attrs = [f'goal_type="{goal}"']
    if tone:
        intent_attrs.append(f'tone_style_hints="{tone}"')
    if langs:
        intent_attrs.append(f'target_langs="{",".join(str(x) for x in langs)}"')
    parts.append(f"<intent {' '.join(intent_attrs)}/>")

    if content_brief:
        parts.append(f"<content_brief>\n{content_brief}\n</content_brief>")
    feedback = [item for item in constraints if item]
    if feedback:
        parts.append("<user_feedback>\n" + "\n".join(feedback) + "\n</user_feedback>")
    return parts


def build_narrative_semantic_plan_prompt(
    blocks: list[dict],
    *,
    language: str | None,
    intent: dict,
    constraints: list[str],
    max_sections: int | None,
    content_brief: str | None = None,
) -> tuple[str, str]:
    if not blocks:
        raise ValueError("NARRATIVE_REVIEW requires non-empty transcript blocks")
    parts = _narrative_context_parts(
        language=language,
        intent=intent,
        constraints=constraints,
        max_sections=max_sections,
        content_brief=content_brief,
    )
    lines = [
        "<blocks>",
        "Rank every block exactly once and assign it to one section. Block order is source order. "
        "Mark essential=true only for sections whose omission would make the narrative materially "
        "incomplete. beat_hint describes the arc role but does not make a section essential. Use "
        "preferred_blocks as soft semantic preferences, not physical position constraints; do not "
        "mark every section essential.",
    ]
    for block in blocks:
        preview = str(block.get("text_preview") or "").replace("\n", " ").strip()
        lines.append(
            f'<block block_id="{block["block_id"]}" ordered_index="{block["ordered_index"]}">'
            f"{preview}</block>"
        )
    lines.append("</blocks>")
    parts.append("\n".join(lines))
    parts.append(NARRATIVE_SEMANTIC_PLAN_OUTPUT_FORMAT)
    return NARRATIVE_SEMANTIC_PLAN_SYSTEM, "\n".join(parts)


def _narrative_pacing_feedback_block(feedback: list[dict] | None) -> str:
    if not feedback:
        return ""
    lines = [
        "<pacing_repair>",
        "The previous draft fell outside the source-language pacing preflight estimate. "
        "Repair only the narration sections reported below; preserve every section_id, selected "
        "block, source grounding, beat order, and story arc. target_chars is an estimate, not a "
        "TTS duration contract; measured TTS remains authoritative.",
    ]
    for item in feedback:
        section_id = item.get("section_id", "")
        target = int(item.get("target_chars") or 0)
        actual = int(item.get("actual_chars") or 0)
        ratio = float(item.get("ratio") or 0.0)
        deficit = int(item.get("deficit_chars") or 0)
        overage = int(item.get("overage_chars") or 0)
        lower = int(item.get("acceptable_lower_chars") or round(target * 0.90))
        upper = int(item.get("acceptable_upper_chars") or round(target * 1.10))
        current_script = str(item.get("current_script") or "")
        status = item.get("pacing_status") or ""
        if status == "UNDERFILL" or deficit > 0:
            instruction = f"add approximately {deficit} characters of grounded narration"
        else:
            instruction = f"trim approximately {overage} characters without dropping the beat"
        lines.append(
            f'<section section_id="{section_id}" target_chars="{target}" '
            f'actual_chars="{actual}" ratio="{ratio:.2f}" pacing_status="{status}" '
            f'acceptable_lower_chars="{lower}" acceptable_upper_chars="{upper}" '
            f'deficit_chars="{deficit}" overage_chars="{overage}">'
            f'{instruction}<current_script>{current_script}</current_script></section>'
        )
    lines.extend([
        "Preserve the existing grounded narration shown in current_script. Expand or trim that "
        "existing script instead of replacing it with a shorter summary. Add only details supported "
        "by the locked transcript and visual evidence; stay inside the acceptable character band.",
        "Return JSON with a sections array containing exactly the reported section_ids in the same "
        "order; include only those replacement sections. Do not add timestamps, source_refs, or "
        "new footage. Runtime restores sections not reported above from the original draft.",
        "Use only the keys defined by the current <output_format>; do not add helper or commentary "
        "fields such as beat_type_note.",
        "</pacing_repair>",
    ])
    return "\n".join(lines)


def _narrative_duplicate_feedback_block(feedback: list[dict] | None) -> str:
    if not feedback:
        return ""
    lines = [
        "<duplicate_repair>",
        "The previous draft violated the narration de-duplication rule. Repair only the reported "
        "section_ids; preserve source grounding, locked footage/source assignment, beat order, and "
        "story arc. target_chars is a source-language estimate, so keep the replacement near that "
        "length and do not make narration shorter just to remove repetition.",
    ]
    for item in feedback:
        section_id = item.get("section_id", "")
        duplicate_kind = item.get("duplicate_kind", "")
        target = int(item.get("target_chars") or 0)
        duplicate_sentence = str(item.get("duplicate_sentence") or "")
        current_script = str(item.get("current_script") or "")
        lines.append(
            f'<section section_id="{section_id}" duplicate_kind="{duplicate_kind}" '
            f'target_chars="{target}"><duplicate_sentence>{duplicate_sentence}</duplicate_sentence>'
            f'<current_script>{current_script}</current_script></section>'
        )
    lines.extend([
        "Replace the offending whole-section or exact sentence wording with a materially different, "
        "section-specific detail supported by that section's transcript and visual evidence. Do not "
        "deduplicate by deleting text, changing section_id, changing footage, or copying another "
        "section. Keep the same beat/order/story role and preserve approximately the current length.",
        "Return JSON with a sections array containing exactly the reported section_ids in the same "
        "order; include only those replacement sections. Do not add timestamps, source_refs, or new "
        "footage. Runtime restores sections not reported above from the original draft.",
        "Use only the keys defined by the current <output_format>; do not add helper or commentary "
        "fields such as beat_type_note.",
        "</duplicate_repair>",
    ])
    return "\n".join(lines)


def _narrative_verbatim_feedback_block(feedback: list[dict] | None) -> str:
    if not feedback:
        return ""
    lines = [
        "<source_copy_repair>",
        "The previous narration copied wording from the transcript evidence of the same locked beat. "
        "Rewrite the reported section in the declared source language as a concise recap; preserve "
        "the section_id, footage assignment, order, and grounded meaning. A short exact phrase may "
        "remain only when it is necessary, but do not reproduce a long source run.",
    ]
    for item in feedback:
        lines.append(
            f'<section section_id="{item.get("section_id", "")}" '
            f'run_words="{int(item.get("run_words") or 0)}" '
            f'target_chars="{int(item.get("target_chars") or 0)}">'
            f'<verbatim_span>{item.get("verbatim_span", "")}</verbatim_span>'
            f'<current_script>{item.get("current_script", "")}</current_script></section>'
        )
    lines.extend([
        "Use section-specific detail from the locked evidence and keep approximately the current "
        "narration length. Do not change section_id, source assignment, or add timestamps/source_refs.",
        "Return exactly the reported section_ids in source order using the current <output_format>.",
        "</source_copy_repair>",
    ])
    return "\n".join(lines)


def _narrative_structure_feedback_block(feedback: list[dict] | None) -> str:
    if not feedback:
        return ""
    lines = [
        "<narrative_structure_repair>",
        "Repair the reported writer-quality violations in place. Keep the same section_id, locked "
        "footage, source grounding, order, beat role, and approximately the same narration length.",
    ]
    for item in feedback:
        lines.append(
            f'<section section_id="{item.get("section_id", "")}" '
            f'violation="{item.get("violation", "")}" '
            f'target_chars="{int(item.get("target_chars") or 0)}">'
            f'<diagnostic>{item.get("message", "")}</diagnostic>'
            f'<current_script>{item.get("current_script", "")}</current_script></section>'
        )
    lines.extend([
        "Return exactly the reported section_ids in source order using the current <output_format>.",
        "Do not add timestamps, source_refs, helper fields, or new footage.",
        "</narrative_structure_repair>",
    ])
    return "\n".join(lines)


def build_narrative_writer_prompt(
    allocated_sections: list[dict],
    *,
    language: str | None,
    intent: dict,
    constraints: list[str],
    content_brief: str | None = None,
    pacing_feedback: list[dict] | None = None,
    duplicate_feedback: list[dict] | None = None,
    verbatim_feedback: list[dict] | None = None,
    structure_feedback: list[dict] | None = None,
) -> tuple[str, str]:
    if not allocated_sections:
        raise ValueError("NARRATIVE_REVIEW writer requires allocated sections")
    parts = _narrative_context_parts(
        language=language,
        intent=intent,
        constraints=constraints,
        max_sections=len(allocated_sections),
        content_brief=content_brief,
    )
    pacing_block = _narrative_pacing_feedback_block(pacing_feedback)
    if pacing_block:
        parts.append(pacing_block)
    duplicate_block = _narrative_duplicate_feedback_block(duplicate_feedback)
    if duplicate_block:
        parts.append(duplicate_block)
    verbatim_block = _narrative_verbatim_feedback_block(verbatim_feedback)
    if verbatim_block:
        parts.append(verbatim_block)
    structure_block = _narrative_structure_feedback_block(structure_feedback)
    if structure_block:
        parts.append(structure_block)
    lines = [
        "<locked_footage>",
        "Footage is final. These are the final small presentation beats (already split, "
        "ordered, coverage-preserving). Return exactly one written section for each section_id in this order.",
    ]
    for section in allocated_sections:
        title = section.get("title") or ""
        goal = section.get("goal") or ""
        beat = section.get("beat_hint") or ""
        blocks = section.get("blocks") or []
        dur_s = sum(int(b.get("end_ms", 0)) - int(b.get("start_ms", 0)) for b in blocks) // 1000
        dur_attr = f' duration_seconds="{dur_s}"' if dur_s > 0 else ""
        target_chars = section.get("target_chars")
        target_attr = f' target_chars="{int(target_chars)}"' if target_chars else ""
        lines.append(
            f'<section section_id="{section["section_id"]}"{dur_attr}{target_attr} title="{title}" '
            f'goal="{goal}" beat_hint="{beat}">'
        )
        for block in blocks:
            text = str(block.get("full_text") or "").strip()
            lines.append(f'<selected_block block_id="{block["block_id"]}">{text}</selected_block>')
        lines.append("</section>")
    lines.append("</locked_footage>")
    if any(s.get("target_chars") for s in allocated_sections):
        lines.append(
            "PACING PREFLIGHT: target_chars is a source-language character estimate only, not a TTS "
            "duration contract. Measured TTS duration remains authoritative. Write each section "
            "near the estimate without leaving most of a visual range unnarrated."
        )
    parts.append("\n".join(lines))
    parts.append(NARRATIVE_WRITER_OUTPUT_FORMAT)
    return NARRATIVE_WRITER_SYSTEM, "\n".join(parts)


# ── TASK 7 — Multimodal Visual Understanding (VLM → narrative grounding) ─────

VLM_SYSTEM_PROMPT = (
    "You are a precise video frame analyst. For each image frame you receive, output ONE JSON object "
    'with exactly these fields (no extra keys):\n'
    '{ "sceneId": "scene-001", "people": 0-100, "objects": ["string"], "location": "string or null", '
    '"action": "string or null (main action)", "text": "string or null (visible OCR)", '
    '"visualDescription": "1-2 sentence dense description", "confidence": 0.0-1.0 }\n'
    "Rules:\n"
    "- people = count of distinct people visible (0 if none)\n"
    "- action = most salient action (e.g. 'two people fighting', 'person presenting at podium')\n"
    "- location = setting (e.g. 'indoor office', 'outdoor street at night')\n"
    "- text = verbatim visible text/OCR, null if none\n"
    "- confidence = your certainty 0..1; be calibrated — low if blurry/occluded\n"
    "- Return ONLY the JSON object, no prose, no fences"
)

NARRATIVE_MULTIMODAL_WRITER_SYSTEM = (
    "You are a source-grounded narrative writer for MULTIMODAL SUMMARY V1 (TASK 7). The selected "
    "footage has already been finalized by deterministic runtime code. You have TWO evidence sources:\n"
    "1) <locked_footage> — timed transcript blocks (speech, authoritative for spoken content)\n"
    "2) <visual_context> — VLM visual observations + temporal scenes (visual, authoritative for actions/scene)\n"
    "Write one narrative section for every locked section_id, in the same order, grounding EVERY claim "
    "in either transcript evidence or visual evidence. BEAT GROUNDING INVARIANT: A narration unit MUST NOT "
    "describe a future visual event before the corresponding visual range begins. Ground each section's "
    "narration strictly to the footage of that section; never leak or anticipate events belonging to "
    "subsequent sections. You MUST be able to describe visual actions even when "
    "the transcript is sparse — e.g. 'at 00:42 two people start fighting' when VLM saw it but transcript did not. "
    "Structure as hook → context → key events → conclusion (HOOK/CONTEXT/RISING_ACTION/CLIMAX/TURNING_POINT/RESOLUTION/PAYOFF/CTA). "
    "Write every narration script in the source language declared by <language> and put it in the "
    "script_source_lang field; target_langs are downstream translation destinations, not the language "
    "for this writer. RECAP STYLE (sentence-level captions): third-person past-tense narration in the "
    "declared source language, structured into distinct short sentences (approximately 4-8 short sentences per section; "
    "pace the narration to naturally fill the section footage duration following the per-section "
    "target_chars estimate without leaving long dead silence); never one huge paragraph; avoid "
    "comma-chained sentences and repetition. Never duplicate an entire section. Across the complete "
    "draft, an exact normalized sentence of 20 or more characters may appear at most twice; after "
    "the second use, rewrite it with section-specific grounded detail. Do not shorten or delete "
    "narration solely to hide repetition. Do NOT reproduce long verbatim source copy (no exact source run "
    "of 15 or more words); do NOT copy long CJK/Han-script or romaji chant material from evidence "
    "unless that material is in the declared source language. When such material is not in the "
    "declared source language, summarize or translate its meaning into the declared source language "
    "instead. Keep the CTA as a separate final sentence. "
    "GROUNDING: each section's script must reference an evidence span — cite transcript block text or visual observation timestamp/action. "
    "CONFIDENCE: if a visual observation's confidence < 0.5, hedge the claim ('appears to', 'possibly') — never assert a low-confidence fact strongly. "
    "Do not hallucinate facts beyond transcript + visual. Do not invent timestamps outside the evidence. "
    "Use only the keys defined by the current <output_format>; do not add helper or commentary "
    "fields such as beat_type_note. Return only the JSON object described in <output_format>."
)


def _visual_context_block(multimodal_context: dict | None) -> str:
    if not multimodal_context:
        return ""
    obs = multimodal_context.get("visual_observations") or []
    scenes = multimodal_context.get("visual_scenes") or []
    lines: list[str] = ["<visual_context>"]
    if multimodal_context.get("multimodal_summary"):
        lines.append(f'<summary>{multimodal_context["multimodal_summary"]}</summary>')
    for sc in scenes:
        sid = sc.get("scene_id", "")
        start = sc.get("start_ms", 0)
        end = sc.get("end_ms", 0)
        action = sc.get("dominant_action") or ""
        loc = sc.get("dominant_location") or ""
        conf = sc.get("confidence", 0.5)
        lines.append(
            f'<scene scene_id="{sid}" start_ms="{start}" end_ms="{end}" confidence="{conf}" action="{action}" location="{loc}"/>'
        )
    for o in obs:
        ts = o.get("timestamp", 0)
        people = o.get("people", 0)
        action = (o.get("action") or "").replace('"', "'").replace("\n", " ").strip()
        loc = (o.get("location") or "").replace('"', "'").replace("\n", " ").strip()
        desc = (o.get("visual_description") or "").replace("\n", " ").strip()
        conf = o.get("confidence", 0.5)
        text = (o.get("text") or "").replace('"', "'").strip()
        hedge = ' hedge="true"' if float(conf) < 0.5 else ""
        txt_attr = f' text="{text}"' if text else ""
        lines.append(
            f'<observation timestamp="{ts}" people="{people}" action="{action}" location="{loc}" confidence="{conf}"{hedge}{txt_attr}>{desc}</observation>'
        )
    lines.append("</visual_context>")
    return "\n".join(lines)


def build_narrative_multimodal_writer_prompt(
    allocated_sections: list[dict],
    *,
    language: str | None,
    intent: dict,
    constraints: list[str],
    content_brief: str | None = None,
    multimodal_context: dict | None = None,
    beat_visuals: list[dict] | None = None,
    pacing_feedback: list[dict] | None = None,
    duplicate_feedback: list[dict] | None = None,
    verbatim_feedback: list[dict] | None = None,
    structure_feedback: list[dict] | None = None,
) -> tuple[str, str]:
    if not allocated_sections:
        raise ValueError("NARRATIVE_REVIEW writer requires allocated sections")
    parts = _narrative_context_parts(
        language=language,
        intent=intent,
        constraints=constraints,
        max_sections=len(allocated_sections),
        content_brief=content_brief,
    )
    pacing_block = _narrative_pacing_feedback_block(pacing_feedback)
    if pacing_block:
        parts.append(pacing_block)
    duplicate_block = _narrative_duplicate_feedback_block(duplicate_feedback)
    if duplicate_block:
        parts.append(duplicate_block)
    verbatim_block = _narrative_verbatim_feedback_block(verbatim_feedback)
    if verbatim_block:
        parts.append(verbatim_block)
    structure_block = _narrative_structure_feedback_block(structure_feedback)
    if structure_block:
        parts.append(structure_block)
    # multimodal block after content_brief/user_feedback
    vblock = _visual_context_block(multimodal_context)
    if vblock:
        parts.append(vblock)
    # Per-beat visual grounding: THIS narration belongs to THIS visual event.
    # The writer must not merge distant ranges or leak future events.
    if beat_visuals:
        glines = ["<beat_grounding>"]
        for bv in beat_visuals:
            sid = bv.get("section_id", "")
            ranges = bv.get("visual_ranges") or []
            desc = (bv.get("visual_description") or "").replace("\n", " ").strip()[:500]
            rattr = " ".join(f'[{r.get("start_ms")}-{r.get("end_ms")}]' for r in ranges)
            glines.append(f'<beat section_id="{sid}" visual_ranges="{rattr}">{desc}</beat>')
        glines.append("</beat_grounding>")
        parts.append("\n".join(glines))
    lines = [
        "<locked_footage>",
        "Footage is final. These are the final small presentation beats (already split, "
        "ordered, coverage-preserving). Return exactly one written section for each section_id in this order.",
        "BEAT GROUNDING: narrate ONLY the <beat> visual event for that section; "
        "never describe a future beat's event early.",
    ]
    for section in allocated_sections:
        title = section.get("title") or ""
        goal = section.get("goal") or ""
        beat = section.get("beat_hint") or ""
        blocks = section.get("blocks") or []
        dur_s = sum(int(b.get("end_ms", 0)) - int(b.get("start_ms", 0)) for b in blocks) // 1000
        dur_attr = f' duration_seconds="{dur_s}"' if dur_s > 0 else ""
        target_chars = section.get("target_chars")
        target_attr = f' target_chars="{int(target_chars)}"' if target_chars else ""
        lines.append(
            f'<section section_id="{section["section_id"]}"{dur_attr}{target_attr} title="{title}" '
            f'goal="{goal}" beat_hint="{beat}">'
        )
        for block in blocks:
            text = str(block.get("full_text") or "").strip()
            lines.append(f'<selected_block block_id="{block["block_id"]}">{text}</selected_block>')
        lines.append("</section>")
    lines.append("</locked_footage>")
    if any(s.get("target_chars") for s in allocated_sections):
        lines.append(
            "PACING PREFLIGHT: target_chars is a source-language character estimate only, not a TTS "
            "duration contract. Measured TTS duration remains authoritative. Write each section "
            "near the estimate without leaving most of a visual range unnarrated."
        )
    parts.append("\n".join(lines))
    parts.append(NARRATIVE_WRITER_OUTPUT_FORMAT)
    return NARRATIVE_MULTIMODAL_WRITER_SYSTEM, "\n".join(parts)
