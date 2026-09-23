import hashlib
import hmac
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.services.callback import send_audio_mix_complete, send_complete, send_progress
from app.services.hmac import sign_payload


def test_hmac_matches_spring_canonical_payload(monkeypatch):
    monkeypatch.setattr(settings, "callback_secret", "shared-secret")
    raw = b'{"jobId":"job-1"}'
    expected = hmac.new(
        b"shared-secret",
        b"1700000000." + raw,
        hashlib.sha256,
    ).hexdigest()

    assert sign_payload("1700000000", raw) == expected


@pytest.mark.asyncio
async def test_render_callbacks_match_backend_main_contract():
    with patch("app.services.callback.send_callback", new=AsyncMock(return_value=True)) as send:
        await send_progress("job-1", "attempt-1", 55, "stage-1")
        await send_complete(
            "job-1",
            "attempt-1",
            "COMPLETED",
            output_ref="transflow-media/rendered/job-1/final.mp4",
            stage_id="stage-1",
        )

    progress = send.await_args_list[0].args[1]
    assert progress == {
        "jobId": "job-1",
        "stageId": "stage-1",
        "dedupeKey": "render:attempt-1:progress:55",
        "progressPercent": 55,
    }

    complete = send.await_args_list[1].args[1]
    assert complete["jobId"] == "job-1"
    assert complete["stageId"] == "stage-1"
    assert complete["dedupeKey"] == "render:attempt-1:complete"
    assert complete["success"] is True
    assert complete["outputRef"]["objectRef"].endswith("final.mp4")


@pytest.mark.asyncio
async def test_audio_mix_complete_matches_backend_main_contract():
    with patch("app.services.callback.send_callback", new=AsyncMock(return_value=True)) as send:
        await send_audio_mix_complete(
            "job-2",
            "attempt-2",
            "FAILED",
            error={"code": "FFMPEG_FAILED", "message": "mix failed"},
            stage_id="stage-2",
        )

    payload = send.await_args.args[1]
    assert payload["jobId"] == "job-2"
    assert payload["stageId"] == "stage-2"
    assert payload["success"] is False
    assert payload["errorMessage"] == "mix failed"
