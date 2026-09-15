"""Unit tests for STT / auth model URL construction (adapter-owned paths)."""
from app.services.protocol.http_utils import openai_models_path, normalize_base_url


def _models_url(base_url: str) -> str:
    """Mirror how OpenAI-compatible adapters build the models catalog URL."""
    return normalize_base_url(base_url) + openai_models_path(base_url)


def test_models_url_keeps_existing_v1_suffix():
    assert _models_url("https://api.openai.com/v1") == "https://api.openai.com/v1/models"
    assert _models_url("https://api.openai.com/v1/") == "https://api.openai.com/v1/models"


def test_models_url_appends_v1_when_missing():
    assert _models_url("https://api.openai.com") == "https://api.openai.com/v1/models"
    assert _models_url("http://localhost:8000") == "http://localhost:8000/v1/models"
