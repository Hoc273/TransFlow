"""CT10.2 worker capability advertisement tests."""

from app.core.capability import (
    CAPABILITY_PROTOCOL_VERSION,
    worker_capability_advertisement,
)
from app.core.config import settings
from app.main import app
from fastapi.testclient import TestClient


def test_advertisement_is_explicit_and_versioned():
    cap = worker_capability_advertisement()
    assert cap["capability_protocol_version"] == CAPABILITY_PROTOCOL_VERSION
    assert "1" in cap["supported_audio_input_versions"]
    assert "MIXED_AUDIO" in cap["supported_audio_sources"]
    assert "LEGACY_ORIGINAL" in cap["supported_audio_sources"]
    assert "LEGACY_DUBBED" in cap["supported_audio_sources"]
    assert "1" in cap["supported_mix_plan_versions"]
    assert "1" in cap["supported_render_request_versions"]
    assert "1" in cap["supported_audio_strategy_output_versions"]
    assert "worker_id" in cap
    assert cap["worker_revision"] == settings.revision


def test_advertisement_declares_subtitle_font_render_feature():
    # Phase 3 (docs/16 §7.1): the legacy-path typography override is an explicit
    # additive render feature — never inferred from version strings.
    cap = worker_capability_advertisement()
    assert "SUBTITLE_FONT" in cap["render_features"]


def test_advertisement_declares_subtitle_mask_render_feature():
    # Phase 4 (docs/16 §7.1): the v1 subtitle cover mask is an explicit
    # additive burn-time render feature.
    cap = worker_capability_advertisement()
    assert "SUBTITLE_MASK" in cap["render_features"]


def test_advertisement_declares_subtitle_mask_blur_render_feature():
    # PRESET-VIZ (docs/97 §19.16): mask style BLUR is its own additive
    # burn-time render feature — Spring fails closed without it, never
    # silently downgrades to SOLID.
    cap = worker_capability_advertisement()
    assert "SUBTITLE_MASK_BLUR" in cap["render_features"]


def test_capabilities_endpoint():
    client = TestClient(app)
    response = client.get("/internal/media/capabilities")
    assert response.status_code == 200
    body = response.json()
    assert body["capability_protocol_version"] == "1"
    assert "MIXED_AUDIO" in body["supported_audio_sources"]
    assert "SUBTITLE_FONT" in body["render_features"]
    assert body["worker_revision"] == settings.revision


def test_health_still_ok():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "active_renders" in response.json()
    assert response.json()["revision"] == settings.revision
