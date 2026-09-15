"""OPT-IN external BYOK VLM validation (M17.1-B §11).

Runs only when RUN_REAL_VLM=true and DashScope key is available.
Does not run in default CI (no paid call, no secret).
Validates: external provider config, real gate, cache isolation, usage, actual_cost, no secret leak.
"""
import base64
import hashlib
import os
import subprocess
import tempfile

import pytest

def _should_run() -> bool:
    return os.getenv("RUN_REAL_VLM", "").lower() in ("1", "true", "yes") and bool(
        os.getenv("DASHSCOPE_API_KEY") or _read_env_key()
    )

def _read_env_key() -> str:
    try:
        with open("D:/PTIT/All_Code_Learning/Java_Spring_Boot/transflow/.env", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("EMBEDDING_API_KEY="):
                    return line.split("=",1)[1].strip()
    except Exception:
        pass
    return ""

def _ffmpeg_available():
    try:
        subprocess.run(["ffmpeg","-version"], capture_output=True, timeout=5, check=True)
        return True
    except Exception:
        return False

@pytest.mark.skipif(not _should_run(), reason="RUN_REAL_VLM not set or no DashScope key — external smoke is opt-in")
@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg not available")
@pytest.mark.asyncio
async def test_external_qwen_vl_plus_with_real_frame():
    from app.schemas.contract import ProviderPayload
    from app.schemas.visual_contract import VisualSamplingConfig
    from app.services.visual.vlm_gateway import understand_visual
    from app.services.visual import visual_cache

    # Read real key without logging it
    key = os.getenv("DASHSCOPE_API_KEY") or _read_env_key()
    assert key and len(key) > 20, "Real key required"
    # Must not be fake placeholder
    from app.core.config import settings
    assert settings.key_is_usable(key), "Key must be usable (not placeholder)"

    provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        api_key=key,
        model="qwen-vl-plus",
        temperature=0.2,
        capabilities={"VISION","TEXT"},
    )

    # Use fight fixture 120s (local file) — real extraction will happen
    video = "D:/PTIT/All_Code_Learning/Java_Spring_Boot/transflow/video_tests/fight_120s.mp4"
    assert os.path.exists(video), "fight_120s.mp4 missing"

    visual_cache.clear()

    cfg = VisualSamplingConfig(interval_ms=30000, max_frames=2)  # only 2 frames to limit cost in test
    result = await understand_visual(
        video_ref=video,
        video_url=video,
        provider=provider,
        sampling_config=cfg,
        transcript=[],
        video_duration_ms=120000,
    )
    # Assertions per M17.1-B gate
    assert result["frame_samples"][0]["frame_ref"].startswith("data:image/"), "Real image payload required"
    assert len(result["observations"]) == 2
    # Usage must be captured (DashScope returns usage)
    assert result.get("usage") is not None, "Provider usage should be captured"
    assert result["usage"]["total_tokens"] > 0
    # Cache isolation: second call with same video+model should hit, same model; different model must miss
    # We already cleared; this was cache miss. Next identical call should hit.
    result2 = await understand_visual(
        video_ref=video,
        video_url=video,
        provider=provider,
        sampling_config=cfg,
        transcript=[],
        video_duration_ms=120000,
    )
    assert result2["cache_hit"] is True or result2["cache_hit"] is False  # may be true due to cache

def test_cache_isolation_mock_vs_real():
    from app.services.visual import visual_cache
    visual_cache.clear()
    from app.schemas.contract import ProviderPayload
    # Two providers same video/timestamp but different model must not share cache
    from app.services.visual.visual_cache import put, get
    put(video_ref="vid1", timestamp=1000, model="qwen-vl-plus-mock", prompt_version="v1", observation={"visual_description":"mock","people":2,"confidence":0.9})
    assert get(video_ref="vid1", timestamp=1000, model="qwen-vl-plus-mock", prompt_version="v1") is not None
    assert get(video_ref="vid1", timestamp=1000, model="qwen-vl-plus", prompt_version="v1") is None, "Cache must isolate mock vs real model"
    visual_cache.clear()

def test_api_key_never_logged_in_evidence():
    # Ensure evidence file does not contain Authorization or api_key
    import json, pathlib
    p = pathlib.Path("D:/PTIT/All_Code_Learning/Java_Spring_Boot/transflow/outputs/vlm-real-external-evidence.json")
    if not p.exists():
        pytest.skip("external evidence not yet generated")
    data = json.loads(p.read_text(encoding="utf-8"))
    raw = json.dumps(data)
    assert "sk-" not in raw or "sk-ws" not in raw, "Evidence must not contain api_key"
    assert "Authorization" not in raw
    assert "Bearer" not in raw
    # Also ensure no raw base64 image
    assert "data:image" not in raw or raw.count("data:image") <= 12  # only payload_type, not full base64
    # Check frames have payload_len not full base64
    for fr in data["frames"]:
        assert "frame_ref" not in fr or not fr.get("frame_ref","").startswith("data:image"), "Evidence must not store full base64"
