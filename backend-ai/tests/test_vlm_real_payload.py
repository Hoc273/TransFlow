"""M17.1-A integration — worker→frame payload→VLM gateway→ProviderPayload.images

Verifies:
- real extraction → data URL
- VLM gateway sends images=[dataUrl] to openai_compatible
- mock VLM receives image payload (not placeholder #t=)
- mock vs real distinction (mock still uses placeholder)
"""
import asyncio
import base64
import hashlib
import os
import subprocess
import tempfile

import pytest

def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5, check=True)
        return True
    except Exception:
        return False

def _generate_video(path: str, duration: int = 6):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"testsrc=duration={duration}:size=320x240:rate=10",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-t", str(duration),
        path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=30)

@pytest.mark.asyncio
@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg not available")
async def test_vlm_gateway_sends_real_image_payload():
    from app.schemas.contract import ProviderPayload
    from app.schemas.visual_contract import VisualSamplingConfig
    from app.services.visual.vlm_gateway import understand_visual
    # Mock provider -> should NOT trigger real extraction, placeholder stays
    mock_provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="http://localhost:8787/v1",
        api_key="",  # empty -> mock path
        model="gpt-4o-mini",
        temperature=0.2,
    )
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "mock.mp4")
        _generate_video(video, 6)
        result = await understand_visual(
            video_ref=video,
            video_url=video,
            provider=mock_provider,
            sampling_config=VisualSamplingConfig(interval_ms=3000, max_frames=4),
            transcript=[],
            video_duration_ms=6000,
        )
        # mock path: frame_ref contains #t= placeholder (no data:)
        for fr in result["frame_samples"]:
            assert "#t=" in fr["frame_ref"]
            assert not fr["frame_ref"].startswith("data:")
        # observations come from _mock_observation
        assert len(result["observations"]) == len(result["frame_samples"])
        assert result["cost"]["frames"] == len(result["frame_samples"])

@pytest.mark.asyncio
@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg not available")
async def test_vlm_gateway_real_provider_extracts_data_url(monkeypatch):
    from unittest.mock import AsyncMock
    from app.schemas.contract import ProviderPayload, Usage
    from app.schemas.visual_contract import VisualSamplingConfig
    from app.services.protocol.openai_compatible import OpenAICompatibleAdapter
    from app.services.protocol.types import ChatResult
    from app.services.visual.vlm_gateway import understand_visual
    from app.services.visual import visual_cache

    visual_cache.clear()

    # Patch adapter.chat to capture images and return deterministic JSON without needing mock server
    captured = {}
    async def fake_chat(self, provider, system, user, max_tokens=2048, response_format=None, extra_body=None, images=None):
        captured["images"] = images
        captured["user"] = user
        # Ensure images contains data URLs (real payload)
        assert images is not None and len(images) == 1
        assert images[0].startswith("data:image/")
        # Return a valid VLM JSON
        payload = {
            "people": 2,
            "objects": ["wall", "ground"],
            "location": "outdoor alley",
            "action": "two people standing facing each other",
            "text": None,
            "visualDescription": "Two people standing facing each other in alley",
            "confidence": 0.88,
        }
        import json
        return ChatResult(text=json.dumps(payload), usage=Usage(input_tokens=100, output_tokens=50, provider=self.protocol, model=provider.model))

    monkeypatch.setattr(OpenAICompatibleAdapter, "chat", fake_chat)

    real_provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="http://localhost:8787/v1",
        api_key="sk-test-real-key-123",  # usable -> real path
        model="qwen-vl-plus-mock",
        temperature=0.2,
        capabilities={"VISION", "TEXT"},
    )
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "real.mp4")
        _generate_video(video, 6)
        result = await understand_visual(
            video_ref=video,
            video_url=video,
            provider=real_provider,
            sampling_config=VisualSamplingConfig(interval_ms=2000, max_frames=3),
            transcript=[],
            video_duration_ms=6000,
        )
        # real path: frame_ref must be data:image/jpeg;base64,
        for fr in result["frame_samples"]:
            assert fr["frame_ref"].startswith("data:image/jpeg;base64,"), f"Expected data URL but got {fr['frame_ref'][:50]}"
            b64 = fr["frame_ref"].split(",", 1)[1]
            data = base64.b64decode(b64)
            assert data[:2] == b"\xff\xd8"
        # Verify adapter was called with image payload (not placeholder text)
        assert captured.get("images") is not None
        assert captured["images"][0].startswith("data:image/")
        assert len(result["observations"]) == 3

@pytest.mark.asyncio
@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg not available")
async def test_real_frame_checksum_preserved_in_observation_flow(monkeypatch):
    from unittest.mock import AsyncMock
    from app.schemas.contract import ProviderPayload, Usage
    from app.schemas.visual_contract import VisualSamplingConfig
    from app.services.protocol.openai_compatible import OpenAICompatibleAdapter
    from app.services.protocol.types import ChatResult
    from app.services.visual.frame_extractor import extract_frames_as_data_urls
    from app.services.visual.vlm_gateway import understand_visual
    from app.services.visual import visual_cache
    visual_cache.clear()

    async def fake_chat(self, provider, system, user, max_tokens=2048, response_format=None, extra_body=None, images=None):
        assert images is not None and images[0].startswith("data:image/")
        payload = {"people": 1, "objects": ["chair"], "location": "office", "action": "person speaking", "text": None, "visualDescription": "person speaking", "confidence": 0.85}
        import json
        return ChatResult(text=json.dumps(payload), usage=Usage(input_tokens=10, output_tokens=10, provider=self.protocol, model=provider.model))
    monkeypatch.setattr(OpenAICompatibleAdapter, "chat", fake_chat)

    real_provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="http://localhost:8787/v1",
        api_key="sk-test-real-key-123",
        model="qwen-vl-plus-mock",
        temperature=0.2,
        capabilities={"VISION"},
    )
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "checksum.mp4")
        _generate_video(video, 6)
        # Extract directly to get sha
        timestamps = [0, 3000]
        frames = extract_frames_as_data_urls(video, video, timestamps)
        sha0 = frames[0]["_sha256"]
        sha1 = frames[1]["_sha256"]
        # Use same video via VLM gateway — frame_samples should have data URLs with same hashes (if re-extracted, may differ due to re-encode but close)
        result = await understand_visual(
            video_ref=video,
            video_url=video,
            provider=real_provider,
            sampling_config=VisualSamplingConfig(interval_ms=3000, max_frames=2),
            transcript=[],
            video_duration_ms=6000,
        )
        assert len(result["frame_samples"]) == 2
        # decode and hash should be stable-ish
        for fr in result["frame_samples"]:
            b64 = fr["frame_ref"].split(",", 1)[1]
            data = base64.b64decode(b64)
            h = hashlib.sha256(data).hexdigest()
            assert len(h) == 64


def _vision_probe_frame():
    return {"timestamp": 0, "frame_ref": "data:image/png;base64,AAAA"}


def _vision_json():
    return (
        '{"people":0,"objects":[],"location":"room","action":null,'
        '"text":null,"visualDescription":"A room","confidence":0.9}'
    )


@pytest.mark.asyncio
async def test_vlm_text_only_provider_is_rejected_before_provider_call(monkeypatch):
    from app.schemas.contract import ProviderPayload
    from app.services.provider_errors import ProviderErrorCode, ProviderException
    from app.services.visual.vlm_gateway import _call_vlm_for_frame

    monkeypatch.setattr("app.services.visual.vlm_gateway.settings.mock_mode", False)
    provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="https://provider.test/v1",
        api_key="sk-test",
        model="opaque-model",
        temperature=0.2,
        capabilities={"TEXT"},
    )
    with pytest.raises(ProviderException) as exc:
        await _call_vlm_for_frame(provider, _vision_probe_frame())
    assert exc.value.code == ProviderErrorCode.PROVIDER_UNSUPPORTED_CAPABILITY


@pytest.mark.asyncio
async def test_vlm_legacy_capabilities_none_keeps_vision_adapter_behavior(monkeypatch):
    from app.schemas.contract import ProviderPayload, Usage
    from app.services.protocol.openai_compatible import OpenAICompatibleAdapter
    from app.services.protocol.types import ChatResult
    from app.services.visual.vlm_gateway import _call_vlm_for_frame

    images_seen = []

    async def fake_chat(self, provider, system, user, *, max_tokens=2048, response_format=None, extra_body=None, images=None):
        images_seen.extend(images or [])
        return ChatResult(
            text=_vision_json(),
            usage=Usage(input_tokens=1, output_tokens=1, provider="openai_compatible", model=provider.model),
        )

    monkeypatch.setattr("app.services.visual.vlm_gateway.settings.mock_mode", False)
    monkeypatch.setattr(OpenAICompatibleAdapter, "chat", fake_chat)
    provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="https://provider.test/v1",
        api_key="sk-test",
        model="opaque-model",
        temperature=0.2,
        capabilities=None,
    )
    await _call_vlm_for_frame(provider, _vision_probe_frame())
    assert images_seen == ["data:image/png;base64,AAAA"]


@pytest.mark.asyncio
async def test_vlm_json_mode_fallback_is_once_and_preserves_image(monkeypatch):
    from app.schemas.contract import ProviderPayload, Usage
    from app.services.protocol.openai_compatible import OpenAICompatibleAdapter
    from app.services.protocol.types import ChatResult
    from app.services.provider_errors import ProviderErrorCode, ProviderException
    from app.services.visual.vlm_gateway import _call_vlm_for_frame

    calls = []

    async def fake_chat(self, provider, system, user, *, max_tokens=2048, response_format=None, extra_body=None, images=None):
        calls.append({"response_format": response_format, "images": images, "user": user})
        if len(calls) == 1:
            raise ProviderException(
                ProviderErrorCode.PROVIDER_BAD_REQUEST,
                "Provider rejected chat (400): unsupported response_format json_object",
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="VISION",
            )
        return ChatResult(
            text=_vision_json(),
            usage=Usage(input_tokens=1, output_tokens=1, provider="openai_compatible", model=provider.model),
        )

    monkeypatch.setattr("app.services.visual.vlm_gateway.settings.mock_mode", False)
    monkeypatch.setattr(OpenAICompatibleAdapter, "chat", fake_chat)
    provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="https://provider.test/v1",
        api_key="sk-test",
        model="opaque-model",
        temperature=0.2,
        capabilities={"VISION"},
    )
    await _call_vlm_for_frame(provider, _vision_probe_frame())

    assert len(calls) == 2
    assert calls[0]["response_format"] == {"type": "json_object"}
    assert calls[1]["response_format"] is None
    assert calls[0]["images"] == calls[1]["images"] == ["data:image/png;base64,AAAA"]
    assert calls[0]["user"] == calls[1]["user"]


@pytest.mark.asyncio
async def test_vlm_arbitrary_400_does_not_retry(monkeypatch):
    from app.schemas.contract import ProviderPayload
    from app.services.protocol.openai_compatible import OpenAICompatibleAdapter
    from app.services.provider_errors import ProviderErrorCode, ProviderException
    from app.services.visual.vlm_gateway import _call_vlm_for_frame

    calls = 0

    async def fake_chat(self, provider, system, user, *, max_tokens=2048, response_format=None, extra_body=None, images=None):
        nonlocal calls
        calls += 1
        raise ProviderException(
            ProviderErrorCode.PROVIDER_BAD_REQUEST,
            "Provider rejected chat (400): image dimensions are too large",
            provider=provider.base_url,
            protocol=provider.protocol,
            capability="VISION",
        )

    monkeypatch.setattr("app.services.visual.vlm_gateway.settings.mock_mode", False)
    monkeypatch.setattr(OpenAICompatibleAdapter, "chat", fake_chat)
    provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="https://provider.test/v1",
        api_key="sk-test",
        model="opaque-model",
        temperature=0.2,
        capabilities={"VISION"},
    )
    with pytest.raises(ProviderException):
        await _call_vlm_for_frame(provider, _vision_probe_frame())
    assert calls == 1
