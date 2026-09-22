"""Explicit CT10.2 worker capability advertisement.

Capability is never inferred from hostname, GPU, container image, or version string.
"""

from __future__ import annotations

import os
from typing import Any

from app.core.config import settings

# Protocol constants — keep in sync with Spring WorkerCapabilityContracts.
CAPABILITY_PROTOCOL_VERSION = "1"
SUPPORTED_AUDIO_INPUT_VERSIONS = ["1"]
SUPPORTED_AUDIO_SOURCES = ["MIXED_AUDIO", "LEGACY_ORIGINAL", "LEGACY_DUBBED"]
SUPPORTED_MIX_PLAN_VERSIONS = ["1"]
SUPPORTED_RENDER_REQUEST_VERSIONS = ["1"]
SUPPORTED_AUDIO_STRATEGY_OUTPUT_VERSIONS = ["1"]
# Phase 3/4 additive render features (Spring WorkerCapabilityContracts):
# SUBTITLE_FONT — legacy-path typography via force_style;
# SUBTITLE_MASK — v1 subtitle cover overlay (drawbox + subtitles, one encode);
# SUBTITLE_MASK_BLUR — PRESET-VIZ (docs/97 §19.16) mask style BLUR (boxblur
# region + subtitles, one encode) — dispatched only when advertised.
# V2 contract freeze F-16/D11 (docs/97 §19.17):
# SUBTITLE_COLORS — legacy-path background_color/text_color force_style;
# SUBTITLE_OUTLINE — legacy-path outline_width/outline_color force_style;
# PRESENTATION_LAYERS_V2 — v2 `layers[]` wire array (all-match gated by
# Spring; when present, layers are authoritative and `mask` is ignored).
# RENDER_OUTPUT_ASPECT — docs/97 §19.19: `output_aspect_ratio` request field;
# the worker reframes (blur-pad) BEFORE burning subtitles/layers. Dispatched
# only when advertised (all-match, fail-closed at claim).
# SUBTITLE_BOX_OUTLINE — 2026-09 dual-event box+outline (Layer 0 yellow box +
# Layer 1 white-outlined glyphs, one encode). Spring claim-gates the
# background_box + outline combination on it so old workers fail closed
# instead of silently dropping the outline.
SUPPORTED_RENDER_FEATURES = [
    "SUBTITLE_FONT",
    "SUBTITLE_MASK",
    "SUBTITLE_MASK_BLUR",
    "SUBTITLE_COLORS",
    "SUBTITLE_OUTLINE",
    "PRESENTATION_LAYERS_V2",
    "RENDER_OUTPUT_ASPECT",
    "SUBTITLE_BOX_OUTLINE",
]


def worker_capability_advertisement() -> dict[str, Any]:
    """Return the explicit internal capability document advertised to Spring."""
    worker_id = os.environ.get("MEDIA_WORKER_ID") or os.environ.get("HOSTNAME") or "default"
    # worker_id is an identifier only — never used as a capability source of truth.
    return {
        "capability_protocol_version": CAPABILITY_PROTOCOL_VERSION,
        "supported_audio_input_versions": list(SUPPORTED_AUDIO_INPUT_VERSIONS),
        "supported_audio_sources": list(SUPPORTED_AUDIO_SOURCES),
        "supported_mix_plan_versions": list(SUPPORTED_MIX_PLAN_VERSIONS),
        "supported_render_request_versions": list(SUPPORTED_RENDER_REQUEST_VERSIONS),
        "supported_audio_strategy_output_versions": list(SUPPORTED_AUDIO_STRATEGY_OUTPUT_VERSIONS),
        "render_features": list(SUPPORTED_RENDER_FEATURES),
        "worker_id": worker_id,
        "worker_revision": settings.revision,
    }
