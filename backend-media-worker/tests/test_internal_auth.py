"""X-Internal-Token gate: only backend-main may call this service (except /health)."""
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)


def test_health_is_always_open(monkeypatch):
    monkeypatch.setattr(settings, "internal_service_token", "s3cret-token")
    assert client.get("/health").status_code == 200


def test_missing_or_wrong_token_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "internal_service_token", "s3cret-token")
    for headers in ({}, {"X-Internal-Token": "wrong"}, {"X-Internal-Token": ""}):
        res = client.get("/openapi.json", headers=headers)
        assert res.status_code == 401
        assert "s3cret-token" not in res.text


def test_correct_token_passes(monkeypatch):
    monkeypatch.setattr(settings, "internal_service_token", "s3cret-token")
    res = client.get("/openapi.json", headers={"X-Internal-Token": "s3cret-token"})
    assert res.status_code == 200


def test_empty_token_disables_check_for_local_dev(monkeypatch):
    monkeypatch.setattr(settings, "internal_service_token", "")
    assert client.get("/openapi.json").status_code == 200
