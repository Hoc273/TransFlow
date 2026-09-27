import pytest

from app.core.config import settings


@pytest.fixture(autouse=True)
def _no_internal_token(monkeypatch):
    """Keep route tests independent from an INTERNAL_SERVICE_TOKEN in the developer's .env."""
    monkeypatch.setattr(settings, "internal_service_token", "")
