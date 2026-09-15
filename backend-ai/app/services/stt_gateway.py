"""Speech-to-text gateway for media pipeline (docs/13, docs/16).

Downloads audio when needed, builds a generic ``AudioInput``, and dispatches
through the protocol adapter registry. No protocol-name branching.
"""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import httpx

from app.core.config import settings
from app.core.logging_config import get_internal_logger, get_provider_logger
from app.schemas.contract import (
    ProviderPayload,
    SttResponse,
    SttSegment,
    SttUsage,
    ValidateProviderResponse,
)
from app.services.protocol import AudioInput, require_adapter
from app.services.provider_errors import (
    ProviderException,
    ProviderErrorCode,
    ProviderTransport,
    ProviderValidation,
    RETRYABLE_HTTP_STATUS,
    map_http_status_to_code,
)
from app.services.transcript_sanity import (
    TranscriptSanityResult,
    TranscriptSanityValidator,
    TranscriptSanityViolation,
)

_int_log = get_internal_logger("stt_gateway")
_prov_log = get_provider_logger("stt_gateway")


def _malformed_message(violation: TranscriptSanityViolation | None,
                       asset_duration_ms: int | None) -> str:
    """Client-safe failure message with the minimum structured diagnostics.

    Never contains provider credentials or raw transcript content.
    """
    if violation is None:
        return "STT transcript timing is invalid"
    details = []
    if asset_duration_ms is not None:
        details.append(f"assetDurationMs={asset_duration_ms}")
    if violation.max_end_ms is not None:
        details.append(f"maxEndMs={violation.max_end_ms}")
    if violation.first_invalid_index is not None:
        details.append(
            f"firstInvalidSegmentIndex={violation.first_invalid_index}"
            f" firstInvalidStartMs={violation.first_invalid_start_ms}"
            f" firstInvalidEndMs={violation.first_invalid_end_ms}"
        )
    if violation.largest_gap_ms is not None:
        details.append(
            f"largestGapMs={violation.largest_gap_ms}"
            f" gapBeforeSegmentIndex={violation.gap_before_index}"
        )
    suffix = " — " + ", ".join(details) if details else ""
    return f"STT transcript timing is invalid ({violation.reason}){suffix}"


def _log_sanity_verdict(verdict, req, attempt: int, segments) -> None:
    """Structured observability event (docs/97 §19.15 §11) — identifies which
    provider/model tends to produce malformed timing. No secrets logged."""
    violation = verdict.violation
    extra = {
        "event": "STT_TRANSCRIPT_SANITY_CHECK",
        "result": verdict.result.value,
        "provider": req.provider.protocol,
        "model": req.provider.model,
        "correlationId": req.correlation_id,
        "mediaJobId": req.media_job_id,
        "assetDurationMs": req.asset_duration_ms,
        "segmentCount": len(segments) if segments is not None else 0,
        "maxEndMs": violation.max_end_ms if violation else None,
        "largestGapMs": violation.largest_gap_ms if violation else None,
        "gapBeforeSegmentIndex": violation.gap_before_index if violation else None,
        "firstInvalidSegmentIndex": violation.first_invalid_index if violation else None,
        "firstInvalidStartMs": violation.first_invalid_start_ms if violation else None,
        "firstInvalidEndMs": violation.first_invalid_end_ms if violation else None,
        "attempt": attempt,
        "failureCode": (
            ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED.value
            if verdict.result is TranscriptSanityResult.MALFORMED
            else None
        ),
    }
    if verdict.result is TranscriptSanityResult.MALFORMED:
        _int_log.warning("STT_TRANSCRIPT_SANITY_CHECK result=MALFORMED", extra=extra)
    elif verdict.result is TranscriptSanityResult.SUSPICIOUS:
        _int_log.warning("STT_TRANSCRIPT_SANITY_CHECK result=SUSPICIOUS", extra=extra)
    else:
        _int_log.info("STT_TRANSCRIPT_SANITY_CHECK result=VALID", extra=extra)


async def transcribe(req: "SttRequest") -> SttResponse:
    """Transcribe an audio file referenced by a presigned URL."""
    from app.schemas.contract import SttRequest  # local import for type only

    adapter = require_adapter(req.provider.protocol, capability="STT")

    if settings.mock_mode or not settings.key_is_usable(req.provider.api_key):
        return _mock_response(req)

    tmp_path: Path | None = None
    try:
        # Build AudioInput. Prefer URL for adapters that accept remote audio
        # (e.g. DashScope). For multipart-only adapters (OpenAI Whisper),
        # download first and pass BYTES.
        audio_input = await _prepare_audio_input(adapter, req.audio_url)
        result = await _transcribe_with_retry(adapter, req, audio_input)
        return SttResponse(
            correlation_id=req.correlation_id,
            status="COMPLETED",
            detected_lang=result.detected_lang,
            segments=result.segments,
            usage=SttUsage(
                audio_seconds=result.audio_seconds,
                provider=req.provider.protocol,
                model=req.provider.model,
            ),
        )
    except ProviderException:
        raise
    except Exception as exc:
        _int_log.exception("STT failed unexpectedly")
        raise ProviderException(
            ProviderErrorCode.PROVIDER_UNKNOWN,
            str(exc),
            provider=req.provider.base_url,
            protocol=req.provider.protocol,
            capability="STT",
        ) from exc
    finally:
        if tmp_path and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


async def _prepare_audio_input(adapter, audio_url: str) -> AudioInput:
    """Choose URL vs downloaded bytes based on what the adapter can consume.

    Adapters declare preference via ``prefers_audio_url()`` — gateways never
    branch on protocol name.
    """
    if adapter.prefers_audio_url():
        return AudioInput.from_url(audio_url)

    # Multipart / binary adapters: download first.
    tmp_path = await _download_audio(audio_url)
    try:
        data = tmp_path.read_bytes()
        return AudioInput.from_bytes(data, filename=tmp_path.name or "audio.wav")
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass


async def _transcribe_with_retry(adapter, req, audio_input: AudioInput):
    attempt = 0
    while True:
        try:
            result = await adapter.transcribe(
                req.provider,
                audio_input,
                source_lang=req.source_lang,
            )
            # STT sanity check (docs/97 §19.15): reject transcripts whose
            # timestamps are inconsistent with the real media duration BEFORE
            # they reach the timing projection. Raising PROVIDER_RESPONSE_
            # MALFORMED (retryable) here reuses the existing retry loop — the
            # provider is re-invoked, never the malformed transcript returned.
            verdict = TranscriptSanityValidator.validate(
                result.segments, req.asset_duration_ms
            )
            _log_sanity_verdict(verdict, req, attempt, result.segments)
            if verdict.result is TranscriptSanityResult.MALFORMED:
                violation = verdict.violation
                raise ProviderValidation(
                    _malformed_message(violation, req.asset_duration_ms),
                    code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                    provider=req.provider.base_url,
                    protocol=req.provider.protocol,
                    capability="STT",
                )
            return result
        except ProviderException as exc:
            if exc.retryable and attempt < settings.max_retries:
                _prov_log.warning(
                    "STT provider retryable error (attempt %d): %s",
                    attempt,
                    exc.code,
                    extra={
                        "errorCode": exc.code,
                        "provider": req.provider.base_url,
                        "protocol": req.provider.protocol,
                    },
                )
                await _sleep_backoff(attempt)
                attempt += 1
                continue
            raise


async def _download_audio(audio_url: str) -> Path:
    """Stream the audio file to a temporary file."""
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.get(audio_url)
            response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise ProviderTransport(
            f"Timeout downloading audio: {exc}",
            code=ProviderErrorCode.PROVIDER_TIMEOUT,
            provider=audio_url,
        ) from exc
    except httpx.TransportError as exc:
        raise ProviderTransport(
            f"Could not download audio: {exc}",
            provider=audio_url,
        ) from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        code = map_http_status_to_code(status)
        retryable = status in RETRYABLE_HTTP_STATUS or status >= 500
        if not retryable:
            raise ProviderException(
                code,
                f"Audio download failed ({status})",
                provider=audio_url,
            ) from exc
        raise ProviderTransport(
            f"Audio download failed ({status})",
            code=code,
            provider=audio_url,
        ) from exc

    with tempfile.NamedTemporaryFile(delete=False, suffix=".audio") as tmp:
        tmp.write(response.content)
        return Path(tmp.name)


def _mock_response(req) -> SttResponse:
    detected = req.source_lang or "en"
    segments = [
        SttSegment(text="This is a mock transcript sentence one.", start_ms=0, end_ms=2400),
        SttSegment(text="This is a mock transcript sentence two.", start_ms=2400, end_ms=5100),
    ]
    return SttResponse(
        correlation_id=req.correlation_id,
        status="COMPLETED",
        detected_lang=detected,
        segments=segments,
        usage=SttUsage(audio_seconds=5.1, provider="mock", model="mock"),
    )


async def validate_provider(provider: ProviderPayload) -> ValidateProviderResponse:
    """Legacy STT validate — prefer 4-phase ``/ai/validate/stt-probe``.

    Kept for backward compatibility; probes adapter registration + capability.
    """
    if settings.mock_mode or not settings.key_is_usable(provider.api_key):
        return ValidateProviderResponse(
            ok=True,
            model=provider.model,
            message="STT provider reachable (mock)",
        )

    try:
        adapter = require_adapter(provider.protocol, capability="STT")
    except ProviderException as exc:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message=str(exc)
        )

    # Light auth probe via adapter headers / models path when available.
    path = adapter.auth_probe_path(provider.base_url)
    if not path:
        return ValidateProviderResponse(
            ok=True,
            model=provider.model,
            message="STT adapter registered (no auth probe path)",
        )

    url = provider.base_url.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=min(settings.request_timeout_seconds, 15.0)) as client:
            response = await client.get(url, headers=adapter.auth_headers(provider.api_key))
    except httpx.TimeoutException:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message="Provider timed out",
        )
    except httpx.TransportError as exc:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message=f"Cannot reach provider: {exc}",
        )

    if response.status_code == 401:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message="Invalid API key (401)",
        )
    if response.status_code == 403:
        return ValidateProviderResponse(
            ok=False, model=provider.model, message="API key forbidden (403)",
        )
    if response.status_code >= 400 and not (
        adapter.soft_pass_auth_on_404() and response.status_code == 404
    ):
        return ValidateProviderResponse(
            ok=False,
            model=provider.model,
            message=f"Provider returned error ({response.status_code})",
        )

    return ValidateProviderResponse(
        ok=True, model=provider.model, message="STT provider reachable",
    )


async def _sleep_backoff(attempt: int) -> None:
    delay = (settings.backoff_base_ms / 1000.0) * (2 ** attempt)
    await asyncio.sleep(delay)
