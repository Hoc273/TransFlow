"""XML-tagged prompt builders (Rule 2 — optimized tagging: <glossary>, <context>,
<source_text>, <output_format>).
"""
from __future__ import annotations

from app.schemas.contract import GlossaryTerm


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
    "Preserve numbers, placeholders ({{name}}, %s), and inline tags exactly. "
    "If <qa_feedback> is present, this is a correction round: produce a new "
    "translation that fixes every listed issue. "
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
            "  <instruction>Return only the translated text in the normal JSON response.</instruction>",
        ]
    )
    lines.append("</generative_tts_feedback>")
    return "\n".join(lines)


def build_translate_prompt(
    source_lang: str,
    target_lang: str,
    source_text: str,
    glossary: list[GlossaryTerm],
    context: dict | None,
) -> tuple[str, str]:
    system = TRANSLATE_SYSTEM.format(source_lang=source_lang, target_lang=target_lang)
    parts: list[str] = []
    gb = _glossary_block(glossary)
    if gb:
        parts.append(gb)
    if context:
        fb = _qa_feedback_block(context.get("qa_feedback") or [])
        if fb:
            parts.append(fb)
        pacing = _generative_tts_feedback_block(
            context.get("generative_tts_feedback")
        )
        if pacing:
            parts.append(pacing)
        # Remaining scalar context (domain, tone, …) as a compact self-closing tag.
        ctx = " ".join(
            f'{k}="{v}"'
            for k, v in context.items()
            if v and k not in {"qa_feedback", "generative_tts_feedback"}
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
    "Return ONLY the JSON object in <output_format>; no prose, no code fences."
)

QA_OUTPUT_FORMAT = (
    '<output_format>{"issues": [{"type": "<check>", '
    '"severity": "critical|high|medium|low", "message": "<what/why>", '
    '"source_span": "<concise excerpt ≤500 chars from source_text>", '
    '"target_span": "<concise excerpt ≤500 chars from translated_text>", '
    '"suggestion": "<fix>", '
    '"blocking_actions": ["BLOCK_EXPORT|BLOCK_RENDER"]'
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
    "essential sections when the target budget permits. Disconnected or distant scenes "
    "must be separated into different "
    "sections; do not group distant scenes into the same section. Do not write narration. Do not "
    "output timestamps, milliseconds, source_refs, duration totals, merged coverage, cuts, or "
    "arithmetic. Return only the JSON object described in <output_format>; no prose or markdown fences."
)

NARRATIVE_WRITER_SYSTEM = (
    "You are a source-grounded narrative writer for GENERATIVE SUMMARY V1 (TASK 6). The selected "
    "footage has already been finalized by deterministic runtime code. Write one narrative section "
    "for every locked section_id, in the same order, using only the selected block text supplied "
    "for that section. BEAT GROUNDING INVARIANT: A narration unit MUST NOT describe a future visual "
    "event before the corresponding visual range begins. Ground each section's narration strictly to "
    "the footage of that section; never leak or anticipate events belonging to subsequent sections. "
    "Ground every narration sentence in the provided source evidence — do not hallucinate facts "
    "beyond the transcript. Write script_source_lang in the source language declared by <language>; "
    "target_langs are downstream translation destinations. Structure the narrative as hook → context "
    "→ key events → conclusion: first section(s) HOOK, then CONTEXT, then "
    "RISING_ACTION/CLIMAX/TURNING_POINT for key events, then RESOLUTION/PAYOFF/CTA for conclusion. "
    "RECAP STYLE (sentence-level captions): write third-person past-tense narration in the target "
    "narration language as clean storytelling, structured into distinct short sentences "
    "(approximately 4-8 short sentences per section; pace the narration to naturally fill the "
    "section footage duration at ~13-16 characters per second or ~2.5-3 words per second without "
    "leaving long dead silence); never emit one huge paragraph for a whole section; avoid sentence "
    "chains joined only by commas; avoid unnecessary repetition and de-duplicate narration. Do NOT "
    "reproduce long verbatim dialogue (no verbatim span longer than 15 words); do NOT copy long "
    "Chinese/Han-script or romaji chant material — when such content matters, summarize or translate "
    "its meaning into the narration language instead. Keep the CTA as a separate final sentence. "
    "You may write headings, narration, transitions in notes, and beat_type from the "
    "allowed list: HOOK, BODY, PAYOFF, CTA, CONTEXT, RISING_ACTION, CLIMAX, TURNING_POINT, "
    "FALLING_ACTION, RESOLUTION, THEME. For each beat also write visual_description (1-2 sentences "
    "describing what the viewer should see, grounded in the source visual implied by the selected "
    "blocks), visual_strategy (SOURCE_CUT for V1 text-grounded; GENERATED/RETRIEVED reserved), "
    "importance 0.0-1.0 (higher = more central), and generate_terms 5-8 concise visual retrieval "
    "terms (e.g. 'sunset beach', 'crowd cheering'). Do not invent custom beat types outside the "
    "allowed list. Do not select footage, omit or add sections, output timestamps, output "
    "milliseconds, output source_refs, change block assignment, or perform duration arithmetic. "
    "Return only the JSON object described in <output_format>; no prose or markdown fences."
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
        status = item.get("pacing_status") or ""
        if status == "UNDERFILL" or deficit > 0:
            instruction = f"add approximately {deficit} characters of grounded narration"
        else:
            instruction = f"trim approximately {overage} characters without dropping the beat"
        lines.append(
            f'<section section_id="{section_id}" target_chars="{target}" '
            f'actual_chars="{actual}" ratio="{ratio:.2f}" pacing_status="{status}" '
            f'deficit_chars="{deficit}" overage_chars="{overage}">{instruction}</section>'
        )
    lines.extend([
        "Return JSON with a sections array containing exactly the reported section_ids in the same "
        "order; include only those replacement sections. Do not add timestamps, source_refs, or "
        "new footage. Runtime restores sections not reported above from the original draft.",
        "</pacing_repair>",
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
    lines = [
        "<locked_footage>",
        "Footage is final. Return exactly one written section for each section_id in this order.",
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
    "RECAP STYLE (sentence-level captions): third-person past-tense narration in the target narration "
    "language, structured into distinct short sentences (approximately 4-8 short sentences per section; "
    "pace the narration to naturally fill the section footage duration at ~13-16 characters per second "
    "or ~2.5-3 words per second without leaving long dead silence); never one huge paragraph; avoid "
    "comma-chained sentences and repetition. Do NOT reproduce long verbatim dialogue (no verbatim span "
    "longer than 15 words); do NOT copy long Chinese/Han-script or romaji chant material — summarize or "
    "translate its meaning instead. Keep the CTA as a separate final sentence. "
    "GROUNDING: each section's script must reference an evidence span — cite transcript block text or visual observation timestamp/action. "
    "CONFIDENCE: if a visual observation's confidence < 0.5, hedge the claim ('appears to', 'possibly') — never assert a low-confidence fact strongly. "
    "Do not hallucinate facts beyond transcript + visual. Do not invent timestamps outside the evidence. Return only the JSON object described in <output_format>."
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
        "Footage is final. Return exactly one written section for each section_id in this order.",
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
