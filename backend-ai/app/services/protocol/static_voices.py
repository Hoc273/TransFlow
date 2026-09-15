"""Static voice catalogs keyed by protocol / preset.

Voice lists must NOT be hardcoded inside adapters. Adapters with
``VoiceDiscoveryStrategy.STATIC`` load catalogs from this registry (or from
preset metadata pushed by Spring Boot). Live AUTO discovery still hits the
vendor API.

DashScope Qwen-Omni voice availability is **model-family specific**
(official list: https://www.alibabacloud.com/help/en/model-studio/omni-voice-list):

* ``qwen-omni-turbo*`` — only Cherry / Serena / Ethan / Chelsie
* ``qwen3.5-omni*`` — Tina default; Elias is **not** supported
* ``qwen3-omni-flash*`` — larger set that includes Elias

Exposing flash-only voices (e.g. Elias) on a turbo/3.5 provider causes
``Voice 'Elias' is not supported`` on preview and job TTS.
"""
from __future__ import annotations

from app.schemas.contract import TtsVoice

# ── Qwen-Omni-Turbo (preset default model) ───────────────────────────────────
# Official default voice is Chelsie; Serena is listed first as the safe
# cross-family probe (works on turbo and qwen3.5 — Cherry does not on 3.5).
DASHSCOPE_TURBO_VOICES: list[TtsVoice] = [
    TtsVoice(voice_id="Serena", language="en-US", gender="FEMALE", display_name="Serena"),
    TtsVoice(voice_id="Ethan", language="en-US", gender="MALE", display_name="Ethan"),
    TtsVoice(voice_id="Cherry", language="zh-CN", gender="FEMALE", display_name="Cherry"),
    TtsVoice(voice_id="Chelsie", language="en-US", gender="FEMALE", display_name="Chelsie"),
]

# ── Qwen3.5-Omni (recommended current series) ────────────────────────────────
# Official default: Tina. Serena kept first for Q-PV-14 probe consistency.
# Source snapshot of commonly used multilingual voices (not the full 50+ set).
DASHSCOPE_QWEN35_VOICES: list[TtsVoice] = [
    TtsVoice(voice_id="Serena", language="en-US", gender="FEMALE", display_name="Serena"),
    TtsVoice(voice_id="Tina", language="en-US", gender="FEMALE", display_name="Tina"),
    TtsVoice(voice_id="Ethan", language="en-US", gender="MALE", display_name="Ethan"),
    TtsVoice(voice_id="Ryan", language="en-US", gender="MALE", display_name="Ryan"),
    TtsVoice(voice_id="Jennifer", language="en-US", gender="FEMALE", display_name="Jennifer"),
    TtsVoice(voice_id="Katerina", language="en-US", gender="FEMALE", display_name="Katerina"),
    TtsVoice(voice_id="Aiden", language="en-US", gender="MALE", display_name="Aiden"),
    TtsVoice(voice_id="Maia", language="en-US", gender="FEMALE", display_name="Maia"),
    TtsVoice(voice_id="Momo", language="zh-CN", gender="FEMALE", display_name="Momo"),
    TtsVoice(voice_id="Mia", language="en-US", gender="FEMALE", display_name="Mia"),
    TtsVoice(voice_id="Harvey", language="en-US", gender="MALE", display_name="Harvey"),
    TtsVoice(voice_id="Raymond", language="en-US", gender="MALE", display_name="Raymond"),
    TtsVoice(voice_id="Cindy", language="zh-TW", gender="FEMALE", display_name="Cindy"),
    TtsVoice(voice_id="Hana", language="vi-VN", gender="FEMALE", display_name="Hana"),
]

# ── Qwen3-Omni-Flash (includes Elias and other flash-only voices) ────────────
DASHSCOPE_FLASH_VOICES: list[TtsVoice] = [
    TtsVoice(voice_id="Serena", language="en-US", gender="FEMALE", display_name="Serena"),
    TtsVoice(voice_id="Cherry", language="zh-CN", gender="FEMALE", display_name="Cherry"),
    TtsVoice(voice_id="Ethan", language="en-US", gender="MALE", display_name="Ethan"),
    TtsVoice(voice_id="Chelsie", language="en-US", gender="FEMALE", display_name="Chelsie"),
    TtsVoice(voice_id="Ryan", language="en-US", gender="MALE", display_name="Ryan"),
    TtsVoice(voice_id="Jennifer", language="en-US", gender="FEMALE", display_name="Jennifer"),
    TtsVoice(voice_id="Katerina", language="en-US", gender="FEMALE", display_name="Katerina"),
    TtsVoice(voice_id="Aiden", language="en-US", gender="MALE", display_name="Aiden"),
    TtsVoice(voice_id="Elias", language="en-US", gender="MALE", display_name="Elias"),
    TtsVoice(voice_id="Maia", language="en-US", gender="FEMALE", display_name="Maia"),
    TtsVoice(voice_id="Momo", language="zh-CN", gender="FEMALE", display_name="Momo"),
    TtsVoice(voice_id="Vivian", language="zh-CN", gender="FEMALE", display_name="Vivian"),
    TtsVoice(voice_id="Moon", language="zh-CN", gender="FEMALE", display_name="Moon"),
    TtsVoice(voice_id="Kai", language="en-US", gender="MALE", display_name="Kai"),
    TtsVoice(voice_id="Nofish", language="zh-CN", gender="MALE", display_name="Nofish"),
    TtsVoice(voice_id="Bella", language="en-US", gender="FEMALE", display_name="Bella"),
]

# Backward-compatible alias: safe default list for preset seed / unknown model.
# Prefer turbo-safe set (matches Spring preset default model qwen-omni-turbo).
# Do NOT include Elias here — it fails on turbo and qwen3.5.
DASHSCOPE_OMNI_VOICES: list[TtsVoice] = list(DASHSCOPE_TURBO_VOICES)

# Fallback names used only when an OpenAI-compatible proxy has no /audio/voices.
# Strategy for openai_compatible is MANUAL — this list is a soft hint for probes
# only, not authoritative discovery.
OPENAI_TTS_HINT_VOICES: list[TtsVoice] = [
    TtsVoice(voice_id="alloy", language="en-US", gender="FEMALE", display_name="Alloy"),
    TtsVoice(voice_id="echo", language="en-US", gender="MALE", display_name="Echo"),
    TtsVoice(voice_id="nova", language="en-US", gender="FEMALE", display_name="Nova"),
    TtsVoice(voice_id="onyx", language="en-US", gender="MALE", display_name="Onyx"),
]

# ── Piper (System tier, zero-key, MIT rhasspy/piper-voices v1.0.0) ────────────
# Voice ids are aligned to the V32 seed asset_key naming scheme (ADR-CEP §6)
# so the Spring strategy layer can map 1:1 once the seed correction lands.
#
# ⚡ AMENDED 2026-08-02 (A1.2 review): "reproducible model assets" — the list
# contains ONLY models verified to exist in the official MIT repo
# rhasspy/piper-voices (piper `voices.json` + VOICES.md + MODEL_CARD).
# The previous 7 vi voices (bich-ngoc, pham-tuyen, ...) do NOT exist upstream
# and were removed. Gender/dialect of the vi models is unknown (MODEL_CARD
# does not publish it) → null. Sample rates are the real model config values
# (vais1000 22050 / 25hours 16000 / vivos 16000), NOT assumed 22050.
# Licensing caveat (documented, not blocking): vivos trains on VIVOS
# (CC BY-NC-SA 4.0 data), 25hours dataset license = unknown → for commercial
# deployments prefer piper-vi-vais1000 (CC-BY-4.0 data, medium quality).
# PiperAdapter.discover_voices further intersects this catalog with the model
# files actually baked in PIPER_VOICES_DIR — no phantom voices.
# ⚡ NOTE (release gate 2026-08-02): the V32 DB seed is UNCHANGED (10 voices,
# CONFIRMED A1.1) — editing it was reverted because it breaks the Flyway
# checksum of already-applied migrations. Therefore asset_key here matches
# the V32 seed only for piper-en-amy/joe/alan; the 3 vi keys
# (piper-vi-vais1000/25hours/vivos) require a NEW additive migration + BA
# approval before the Spring strategy layer can map 1:1 (see docs/93 v4).
PIPER_VOICES: list[TtsVoice] = [
    TtsVoice(voice_id="piper-vi-vais1000", language="vi-VN", gender=None, display_name="VAIS1000 (Piper)"),
    TtsVoice(voice_id="piper-vi-25hours", language="vi-VN", gender=None, display_name="25 Hours Single (Piper)"),
    TtsVoice(voice_id="piper-vi-vivos", language="vi-VN", gender=None, display_name="VIVOS (Piper)"),
    TtsVoice(voice_id="piper-en-amy", language="en-US", gender="FEMALE", display_name="Amy (Piper)"),
    TtsVoice(voice_id="piper-en-joe", language="en-US", gender="MALE", display_name="Joe (Piper)"),
    TtsVoice(voice_id="piper-en-alan", language="en-GB", gender="MALE", display_name="Alan (Piper)"),
]

# asset_key → rhasspy/piper-voices model stem (used to locate .onnx/.onnx.json).
PIPER_VOICE_MODELS: dict[str, str] = {
    "piper-vi-vais1000": "vi_VN-vais1000-medium",
    "piper-vi-25hours": "vi_VN-25hours_single-low",
    "piper-vi-vivos": "vi_VN-vivos-x_low",
    "piper-en-amy": "en_US-amy-medium",
    "piper-en-joe": "en_US-joe-medium",
    "piper-en-alan": "en_GB-alan-medium",
}

# ── Google Cloud TTS (Workspace tier, BYOK) — snapshot 2026-08-02 ─────────────
# Official GA list for vi-VN (docs.cloud.google.com/text-to-speech/docs/
# list-voices-and-types): Neural2-A/D + Standard-A..D + Wavenet-A..D = 10.
# The 2 newest (Neural2-A, Neural2-D) are listed first per Q-M-TTS-05 quality
# ordering. The Chirp3-HD family (28 vi voices) is intentionally excluded:
# SSML-unsupported and outside the ADR-CEP "12 giọng vi" decision scope.
GOOGLE_TTS_VOICES: list[TtsVoice] = [
    TtsVoice(voice_id="vi-VN-Neural2-A", language="vi-VN", gender="FEMALE", display_name="Neural2-A (Google)"),
    TtsVoice(voice_id="vi-VN-Neural2-D", language="vi-VN", gender="MALE", display_name="Neural2-D (Google)"),
    TtsVoice(voice_id="vi-VN-Wavenet-A", language="vi-VN", gender="FEMALE", display_name="Wavenet-A (Google)"),
    TtsVoice(voice_id="vi-VN-Wavenet-B", language="vi-VN", gender="MALE", display_name="Wavenet-B (Google)"),
    TtsVoice(voice_id="vi-VN-Wavenet-C", language="vi-VN", gender="FEMALE", display_name="Wavenet-C (Google)"),
    TtsVoice(voice_id="vi-VN-Wavenet-D", language="vi-VN", gender="MALE", display_name="Wavenet-D (Google)"),
    TtsVoice(voice_id="vi-VN-Standard-A", language="vi-VN", gender="FEMALE", display_name="Standard-A (Google)"),
    TtsVoice(voice_id="vi-VN-Standard-B", language="vi-VN", gender="MALE", display_name="Standard-B (Google)"),
    TtsVoice(voice_id="vi-VN-Standard-C", language="vi-VN", gender="FEMALE", display_name="Standard-C (Google)"),
    TtsVoice(voice_id="vi-VN-Standard-D", language="vi-VN", gender="MALE", display_name="Standard-D (Google)"),
]

# ── Azure Speech (Workspace tier, BYOK) ────────────────────────────────────────
AZURE_TTS_VOICES: list[TtsVoice] = [
    TtsVoice(voice_id="vi-VN-HoaiMyNeural", language="vi-VN", gender="FEMALE", display_name="Hoài My (Azure)"),
    TtsVoice(voice_id="vi-VN-NamMinhNeural", language="vi-VN", gender="MALE", display_name="Nam Minh (Azure)"),
]

# Protocol → default probe voice (must stay aligned with Spring Boot ProviderPresetService).
DEFAULT_PROBE_VOICES: dict[str, str] = {
    "dashscope_native": "Serena",
    "openai_compatible": "alloy",
    "local_piper": "piper-vi-vais1000",
    "google_speech": "vi-VN-Neural2-A",
    "azure_speech": "vi-VN-HoaiMyNeural",
}


def voices_for_dashscope_model(model: str | None) -> list[TtsVoice]:
    """Return the STATIC catalog appropriate for a Qwen-Omni model id."""
    m = (model or "").strip().lower()
    if "3.5" in m:
        return list(DASHSCOPE_QWEN35_VOICES)
    # qwen3-omni-flash* (not 3.5)
    if "qwen3-omni" in m or "qwen3_omni" in m:
        return list(DASHSCOPE_FLASH_VOICES)
    if "turbo" in m or not m:
        return list(DASHSCOPE_TURBO_VOICES)
    # Unknown omni-ish model: turbo-safe intersection (no Elias / flash-only).
    return list(DASHSCOPE_TURBO_VOICES)


def voices_for_protocol(protocol: str, model: str | None = None) -> list[TtsVoice]:
    if protocol == "dashscope_native":
        return voices_for_dashscope_model(model)
    if protocol == "openai_compatible":
        return list(OPENAI_TTS_HINT_VOICES)
    if protocol == "local_piper":
        return list(PIPER_VOICES)
    if protocol == "google_speech":
        return list(GOOGLE_TTS_VOICES)
    if protocol == "azure_speech":
        return list(AZURE_TTS_VOICES)
    return []


def default_probe_voice_for_protocol(protocol: str) -> str | None:
    """Return the preset default probe voice for a protocol, or None."""
    if not protocol:
        return None
    if protocol in DEFAULT_PROBE_VOICES:
        return DEFAULT_PROBE_VOICES[protocol]
    voices = voices_for_protocol(protocol)
    return voices[0].voice_id if voices else None
