"""OpenAI-compatible protocol adapter (TEXT + VISION + STT + TTS)."""
from __future__ import annotations

import io
import json
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.schemas.contract import ProviderPayload, SttSegment, TtsVoice, Usage
from app.services.protocol.adapter import ProtocolAdapter
from app.services.protocol.http_utils import (
    join_url,
    openai_models_path,
    raise_for_http_status,
)
from app.services.protocol.static_voices import OPENAI_TTS_HINT_VOICES
from app.services.protocol.types import (
    AudioInput,
    AudioInputType,
    Capability,
    ChatResult,
    ModelDiscoveryResult,
    SynthesizeResult,
    TranscribeResult,
    ValidationPhaseResult,
    VoiceDiscoveryResult,
    VoiceDiscoveryStrategy,
)
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderTransport,
    ProviderValidation,
)


# Wire-level DEBUG dump logger. Only emits when DEBUG_LLM_WIRE=1 is set
# in the environment. Used to answer "did the gateway actually send
# thinking=disabled?" / "did the model return JSON anywhere?" without
# modifying production code paths.
_debug_log = None  # lazy: see _debug_dump below

_prov_log = get_provider_logger("adapter.openai_compatible")
_NO_VOICE_DISCOVERY_STATUS = {404, 405, 501}


def _flatten_content(content: Any) -> str:
    """Coerce OpenAI ``choices[0].message.content`` into a flat string.

    Accepts:
      * ``None`` / missing → ``""``
      * ``str`` → as-is (stripped)
      * ``list`` of content parts (OpenAI multimodal): concatenate any
        ``{"type": "text", "text": ...}`` parts and any bare ``str`` items.
        Non-text parts (e.g. ``image_url``) are ignored for the purpose of
        text extraction — call sites downstream need plain prose / JSON.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                if item:
                    parts.append(item)
            elif isinstance(item, dict):
                if item.get("type") == "text":
                    text_value = item.get("text")
                    if isinstance(text_value, str) and text_value:
                        parts.append(text_value)
        return "".join(parts).strip()
    return ""


def _voice(
    voice_id: str,
    display_name: str | None = None,
    language: str | None = None,
    gender: str | None = None,
) -> TtsVoice:
    normalized_gender = "MALE" if (gender or "").upper() == "MALE" else "FEMALE"
    return TtsVoice(
        voice_id=voice_id,
        language=language or "und",
        gender=normalized_gender,
        display_name=display_name or voice_id,
    )


def _debug_dump_request(payload: dict[str, Any], url: str, headers: dict[str, str]) -> None:
    """Log the complete wire-level request when DEBUG_LLM_WIRE is enabled.

    Headers are logged with the API key REDACTED — everything past the
    last 4 chars of the bearer token is replaced with ``****``.
    """
    global _debug_log
    if not settings.debug_llm_wire:
        return
    if _debug_log is None:
        from app.core.logging_config import get_debug_logger
        _debug_log = get_debug_logger("openai_compatible.chat")
    redacted_headers = {}
    for k, v in headers.items():
        if k.lower() in ("authorization", "x-api-key") and isinstance(v, str):
            redacted_headers[k] = (v[:7] + "****") if len(v) > 7 else "****"
        else:
            redacted_headers[k] = v
    _debug_log.info(
        "WIRE_REQUEST url=%s headers=%s payload=%s",
        url,
        redacted_headers,
        json.dumps(payload, ensure_ascii=False, default=str),
        extra={
            "url": url,
            "wireRequest": payload,
            "wireRequestHeaders": redacted_headers,
        },
    )


def _debug_dump_response(resp: "httpx.Response", body_text: str) -> None:
    """Log the complete raw HTTP response body when DEBUG_LLM_WIRE is on."""
    if not settings.debug_llm_wire:
        return
    # Try to parse the body as JSON first so the log line carries the full
    # structured object. Fall back to raw text if the body is not JSON
    # (e.g. HTML error page). Never raise from here — debug logging must
    # never break the main path.
    body_obj: Any
    body_obj_parse_error: Optional[str] = None
    try:
        body_obj = resp.json()
    except Exception as exc:
        body_obj = None
        body_obj_parse_error = f"{type(exc).__name__}: {exc}"

    finish_reason = None
    usage = None
    content = None
    reasoning_content = None
    has_tool_calls = None
    has_refusal = None
    if isinstance(body_obj, dict):
        choices = body_obj.get("choices") or []
        if choices and isinstance(choices[0], dict):
            finish_reason = choices[0].get("finish_reason")
            message = choices[0].get("message") or {}
            content = message.get("content")
            reasoning_content = message.get("reasoning_content")
            has_tool_calls = bool(message.get("tool_calls"))
            has_refusal = message.get("refusal")
        usage = body_obj.get("usage")

    _debug_log.info(
        "WIRE_RESPONSE status=%s content_type=%s body_len=%d "
        "finish_reason=%s usage=%s choices_count=%d "
        "message_content=%s message_reasoning_content=%s "
        "has_tool_calls=%s refusal=%s "
        "raw_body=%s raw_body_parse_error=%s",
        resp.status_code,
        resp.headers.get("content-type"),
        len(body_text),
        finish_reason,
        usage,
        len(body_obj.get("choices") or []) if isinstance(body_obj, dict) else 0,
        content,
        reasoning_content,
        has_tool_calls,
        has_refusal,
        body_text,  # COMPLETE raw body — no truncation, no normalization
        body_obj_parse_error,
        extra={
            "httpStatus": resp.status_code,
            "wireFinishReason": finish_reason,
            "wireUsage": usage,
            "wireMessageContent": content,
            "wireMessageReasoningContent": reasoning_content,
            "wireHasToolCalls": has_tool_calls,
            "wireRefusal": has_refusal,
            "wireRawBody": body_text,
            "wireRawBodyParseError": body_obj_parse_error,
            "wireBodyObject": body_obj,
        },
    )


class OpenAICompatibleAdapter(ProtocolAdapter):
    protocol = "openai_compatible"
    supported_capabilities = frozenset({
        Capability.TEXT.value,
        Capability.STT.value,
        Capability.TTS.value,
        Capability.VISION.value,
    })
    # User enters Voice ID (alloy/echo/…) or proxy-specific names.
    # Live /audio/voices is non-standard; we may soft-probe it but strategy is MANUAL.
    voice_discovery_strategy = VoiceDiscoveryStrategy.MANUAL
    default_probe_voice = "alloy"

    # ── Auth ─────────────────────────────────────────────────────────────────

    def auth_probe_path(self, base_url: str) -> str:
        return openai_models_path(base_url)

    def soft_pass_auth_on_404(self) -> bool:
        return True

    def optional_feature_hints(self) -> dict[str, bool]:
        return {"streaming": True, "tool_calling": False, "realtime": False}

    # ── TEXT ─────────────────────────────────────────────────────────────────

    def text_reasoning_extra(
        self,
        provider: ProviderPayload,
        *,
        disabled: bool,
    ) -> Optional[dict[str, Any]]:
        if disabled:
            return {"thinking": {"type": "disabled"}}
        return None

    async def chat(
        self,
        provider: ProviderPayload,
        system: str,
        user: str,
        *,
        max_tokens: int = 2048,
        response_format: Optional[dict[str, Any]] = None,
        extra_body: Optional[dict[str, Any]] = None,
        images: Optional[list[str]] = None,
    ) -> ChatResult:
        request_capability = Capability.VISION.value if images else Capability.TEXT.value
        # Image input is a first-class VISION operation. IMAGE is reserved for
        # generation and VIDEO has no generic input operation here.
        if images:
            self.require_provider_capability(provider, Capability.VISION)
            url = join_url(provider.base_url, "/chat/completions")
            # Build vision message (OpenAI spec: content array with text + image_url)
            user_parts: list[dict[str, Any]] = [{"type": "text", "text": user}]
            for img_url in images:
                # img_url may be http(s) URL or data:image/...;base64
                if not (
                    isinstance(img_url, str)
                    and (
                        img_url.startswith("http://")
                        or img_url.startswith("https://")
                        or img_url.startswith("data:image/")
                    )
                ):
                    raise ProviderValidation(
                        "VISION requires an image URL or image data URL",
                        code=ProviderErrorCode.PROVIDER_BAD_REQUEST,
                        provider=provider.base_url,
                        protocol=provider.protocol,
                        capability=Capability.VISION.value,
                    )
                user_parts.append({"type": "image_url", "image_url": {"url": img_url}})
            payload: dict[str, Any] = {
                "model": provider.model,
                "temperature": provider.temperature,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_parts},
                ],
            }
        else:
            self.require_provider_capability(provider, Capability.TEXT)
            url = join_url(provider.base_url, "/chat/completions")
            payload: dict[str, Any] = {
                "model": provider.model,
                "temperature": provider.temperature,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            }
        if response_format:
            payload["response_format"] = response_format
        if extra_body:
            # Caller-provided extras win on key conflict. ``payload`` keys take
            # precedence because they are the gateway's own contract.
            merged = {**extra_body, **payload}
            payload.clear()
            payload.update(merged)
        # Reasoning-capable models (DeepSeek V4 family on OpenCode Zen, Qwen
        # reasoning variants, …) may spend several seconds producing
        # chain-of-thought before emitting the JSON payload. Use the wider
        # ``text_request_timeout_seconds`` budget for TEXT calls.
        timeout = settings.text_request_timeout_seconds
        request_headers = self.auth_headers(provider.api_key)
        # Wire-level DEBUG dump — emits only when DEBUG_LLM_WIRE=1.
        # Captures the COMPLETE request payload (model, messages,
        # response_format, thinking, …) before any provider call so we
        # can confirm fields are actually being sent.
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                _debug_dump_request(payload, url, request_headers)
                resp = await client.post(
                    url,
                    headers=request_headers,
                    json=payload,
                )
                _debug_dump_response(resp, resp.text)

                if self._should_retry_without_thinking(resp, payload):
                    fallback_payload = dict(payload)
                    fallback_payload.pop("thinking", None)
                    _prov_log.info(
                        "OpenAI-compatible model rejected thinking control; "
                        "retrying once without it",
                        extra={
                            "protocol": self.protocol,
                            "capability": "TEXT",
                            "model": provider.model,
                            "vendorStatus": resp.status_code,
                        },
                    )
                    _debug_dump_request(fallback_payload, url, request_headers)
                    resp = await client.post(
                        url,
                        headers=request_headers,
                        json=fallback_payload,
                    )
                    _debug_dump_response(resp, resp.text)
                    payload = fallback_payload

                if self._should_retry_without_response_format(resp, payload):
                    # JSON mode is only a hint: the gateways parse JSON from plain text.
                    fallback_payload = dict(payload)
                    fallback_payload.pop("response_format", None)
                    _prov_log.info(
                        "OpenAI-compatible model rejected response_format; retrying once without it",
                        extra={
                            "protocol": self.protocol,
                            "capability": "TEXT",
                            "model": provider.model,
                            "vendorStatus": resp.status_code,
                        },
                    )
                    _debug_dump_request(fallback_payload, url, request_headers)
                    resp = await client.post(
                        url,
                        headers=request_headers,
                        json=fallback_payload,
                    )
                    _debug_dump_response(resp, resp.text)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability=request_capability,
            ) from exc

        raise_for_http_status(resp, provider, operation="chat", capability=request_capability, log=_prov_log)
        data = resp.json()
        choice0 = (data.get("choices") or [{}])[0]
        message = choice0.get("message") or {}
        content = message.get("content")
        text = _flatten_content(content)

        # Fallback: some OpenAI-compatible vendors (notably OpenCode Zen with
        # DeepSeek V4 family) emit the assistant reply inside ``reasoning_content``
        # while leaving ``content`` empty. Recover that here so downstream
        # parsing does not see a zero-length answer.
        # See opencode issues #37073, #37609, #28955, #37852.
        if not text:
            reasoning = message.get("reasoning_content")
            if isinstance(reasoning, str) and reasoning.strip():
                _prov_log.warning(
                    "Provider returned empty content; falling back to reasoning_content "
                    "model=%s finish_reason=%s reasoning_preview=%r",
                    provider.model,
                    choice0.get("finish_reason"),
                    reasoning.strip()[:300],
                    extra={
                        "provider": provider.base_url,
                        "protocol": provider.protocol,
                        "capability": "TEXT",
                        "vendorStatus": resp.status_code,
                    },
                )
                text = reasoning.strip()
            else:
                # Diagnostic breadcrumb — captures finish_reason / refusal /
                # tool_calls so future occurrences are explainable without
                # re-running with debug logging.
                _prov_log.warning(
                    "Provider returned empty content and no reasoning_content fallback "
                    "model=%s finish_reason=%s refusal=%s tool_calls=%s",
                    provider.model,
                    choice0.get("finish_reason"),
                    message.get("refusal"),
                    bool(message.get("tool_calls")),
                    extra={
                        "provider": provider.base_url,
                        "protocol": provider.protocol,
                        "capability": "TEXT",
                        "vendorStatus": resp.status_code,
                    },
                )

        u = data.get("usage") or {}
        # C2: capture provider request id from response headers (additive, header may be absent)
        rid = (
            resp.headers.get("x-request-id")
            or resp.headers.get("x-requestid")
            or resp.headers.get("x-dashscope-request-id")
            or resp.headers.get("request-id")
            or resp.headers.get("x-ms-request-id")
        )
        return ChatResult(
            text=text,
            usage=Usage(
                input_tokens=u.get("prompt_tokens", 0),
                output_tokens=u.get("completion_tokens", 0),
                provider=self.protocol,
                model=provider.model,
            ),
            finish_reason=choice0.get("finish_reason") or "stop",
            request_id=rid,
        )

    # ── STT ──────────────────────────────────────────────────────────────────

    @staticmethod
    def _should_retry_without_thinking(
        response: httpx.Response,
        payload: dict[str, Any],
    ) -> bool:
        """Detect a provider rejection of Transflow's thinking disable control."""
        if payload.get("thinking") != {"type": "disabled"} or response.status_code != 400:
            return False
        try:
            detail = (response.text or "").casefold()
        except Exception:
            return False
        if "thinking" not in detail:
            return False
        unsupported_markers = (
            "not support",
            "unsupported",
            "unknown parameter",
            "unrecognized parameter",
            "unexpected parameter",
            "invalid parameter",
            "invalid_parameter",
            "invalidparameter",
            "unknown field",
            "unrecognized field",
            "not allowed",
            "extra inputs are not permitted",
        )
        return any(marker in detail for marker in unsupported_markers)

    @staticmethod
    def _should_retry_without_response_format(
        response: httpx.Response,
        payload: dict[str, Any],
    ) -> bool:
        """Allow one narrow retry when a provider rejects this optional field."""
        if "response_format" not in payload or response.status_code != 400:
            return False
        try:
            detail = (response.text or "").casefold()
        except Exception:
            return False
        if "response_format" not in detail:
            return False
        unsupported_markers = (
            "not support",
            "unsupported",
            "unknown",
            "unrecognized",
            "unexpected",
            "invalid parameter",
            "invalid_parameter",
            "not allowed",
            "extra inputs are not permitted",
        )
        return any(marker in detail for marker in unsupported_markers)

    async def transcribe(
        self,
        provider: ProviderPayload,
        audio: AudioInput,
        *,
        source_lang: Optional[str] = None,
    ) -> TranscribeResult:
        self.require_provider_capability(provider, Capability.STT)
        url = join_url(provider.base_url, "/audio/transcriptions")
        stt_timeout = max(settings.request_timeout_seconds, 600.0)

        file_bytes, file_name, mime = self._resolve_multipart(audio)
        data: dict[str, str] = {"model": provider.model, "response_format": "verbose_json"}
        if source_lang:
            data["language"] = source_lang

        try:
            async with httpx.AsyncClient(timeout=stt_timeout) as client:
                response = await client.post(
                    url,
                    headers=self.auth_headers(provider.api_key),
                    data=data,
                    files={"file": (file_name, io.BytesIO(file_bytes), mime)},
                )
                if self._should_retry_without_response_format(response, data):
                    fallback_data = dict(data)
                    fallback_data.pop("response_format", None)
                    _prov_log.info(
                        "OpenAI-compatible transcription rejected response_format; "
                        "retrying once without it",
                        extra={
                            "protocol": self.protocol,
                            "capability": Capability.STT.value,
                            "model": provider.model,
                            "vendorStatus": response.status_code,
                        },
                    )
                    response = await client.post(
                        url,
                        headers=self.auth_headers(provider.api_key),
                        data=fallback_data,
                        files={"file": (file_name, io.BytesIO(file_bytes), mime)},
                    )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            ) from exc

        raise_for_http_status(response, provider, operation="transcription", capability="STT", log=_prov_log)
        try:
            payload = response.json()
        except Exception as exc:
            raise ProviderValidation(
                "STT provider returned non-JSON response",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            ) from exc
        return self._parse_whisper_response(payload)

    def _resolve_multipart(self, audio: AudioInput) -> tuple[bytes, str, str]:
        """OpenAI Whisper expects multipart file upload."""
        if audio.type == AudioInputType.URL:
            # Caller should download first for this adapter; if only URL is given
            # we fail with a clear configuration error.
            if audio.data is None and audio.path is None:
                raise ProviderValidation(
                    "OpenAI-compatible STT requires local audio bytes (multipart upload); "
                    "URL-only input is not supported by this adapter",
                    code=ProviderErrorCode.PROVIDER_BAD_REQUEST,
                    protocol=self.protocol,
                    capability="STT",
                )
        file_bytes = audio.as_bytes()
        file_name = audio.filename or "audio.wav"
        mime = audio.mime_type or "audio/wav"
        return file_bytes, file_name, mime

    @staticmethod
    def _parse_whisper_response(payload: dict) -> TranscribeResult:
        if not isinstance(payload, dict):
            raise ProviderValidation(
                "STT provider returned an object with an unsupported shape",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                capability=Capability.STT.value,
            )

        detected_lang = (
            payload.get("language")
            or payload.get("detected_language")
            or payload.get("detected_lang")
            or payload.get("lang")
            or None
        )
        duration_value = payload.get("duration")
        if not OpenAICompatibleAdapter._is_number(duration_value):
            duration_ms = payload.get("duration_ms")
            duration_value = float(duration_ms) / 1000.0 if OpenAICompatibleAdapter._is_number(duration_ms) else 0.0
        duration = float(duration_value or 0.0)
        segments: list[SttSegment] = []

        raw_segments = payload.get("segments")
        if not isinstance(raw_segments, list):
            for alias in ("data", "results"):
                candidate = payload.get(alias)
                if (
                    isinstance(candidate, list)
                    and candidate
                    and all(
                        isinstance(item, dict)
                        and isinstance(item.get("text"), str)
                        and (
                            ("start" in item and "end" in item)
                            or ("start_ms" in item and "end_ms" in item)
                        )
                        for item in candidate
                    )
                ):
                    raw_segments = candidate
                    break
        if isinstance(raw_segments, list):
            for seg in raw_segments:
                if not isinstance(seg, dict):
                    continue
                text = (seg.get("text") or "").strip()
                start_ms, end_ms = OpenAICompatibleAdapter._segment_timestamps_ms(seg)
                if text and start_ms is not None and end_ms is not None and end_ms > start_ms:
                    segments.append(
                        SttSegment(
                            text=text,
                            start_ms=start_ms,
                            end_ms=end_ms,
                            confidence=seg.get("confidence"),
                        )
                    )

        if not segments:
            raise ProviderValidation(
                "STT provider returned no usable timed segments",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                capability=Capability.STT.value,
            )

        return TranscribeResult(
            segments=segments,
            detected_lang=detected_lang,
            audio_seconds=duration,
        )

    @staticmethod
    def _segment_timestamps_ms(segment: dict[str, Any]) -> tuple[int | None, int | None]:
        """Normalize seconds or explicit millisecond segment timestamps."""
        start_ms = segment.get("start_ms")
        end_ms = segment.get("end_ms")
        if OpenAICompatibleAdapter._is_number(start_ms) and OpenAICompatibleAdapter._is_number(end_ms):
            return int(start_ms), int(end_ms)

        start = segment.get("start")
        end = segment.get("end")
        if OpenAICompatibleAdapter._is_number(start) and OpenAICompatibleAdapter._is_number(end):
            return int(float(start) * 1000), int(float(end) * 1000)
        return None, None

    @staticmethod
    def _is_number(value: Any) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    # ── TTS ──────────────────────────────────────────────────────────────────

    async def synthesize(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        self.require_provider_capability(provider, Capability.TTS)
        payload = {
            "model": provider.model,
            "input": text,
            "voice": voice_id,
            "response_format": "mp3",
        }
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                response = await client.post(
                    join_url(provider.base_url, "/audio/speech"),
                    headers=self.auth_headers(provider.api_key),
                    json=payload,
                )
                if self._should_retry_without_response_format(response, payload):
                    fallback_payload = dict(payload)
                    fallback_payload.pop("response_format", None)
                    _prov_log.info(
                        "OpenAI-compatible speech rejected response_format; "
                        "retrying once without it",
                        extra={
                            "protocol": self.protocol,
                            "capability": Capability.TTS.value,
                            "model": provider.model,
                            "vendorStatus": response.status_code,
                        },
                    )
                    response = await client.post(
                        join_url(provider.base_url, "/audio/speech"),
                        headers=self.auth_headers(provider.api_key),
                        json=fallback_payload,
                    )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            ) from exc

        raise_for_http_status(response, provider, operation="speech synthesis", capability="TTS", log=_prov_log)
        if not response.content:
            raise ProviderValidation(
                "TTS provider returned empty audio",
                code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            )
        content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().casefold()
        if content_type.startswith("audio/") and content_type not in {"audio/mpeg", "audio/mp3"}:
            raise ProviderValidation(
                f"OpenAI-compatible TTS returned non-MP3 audio ({content_type})",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability=Capability.TTS.value,
            )
        return SynthesizeResult(
            audio_bytes=response.content,
            mime_type="audio/mpeg",
            metadata={"format": "mp3"},
        )

    async def discover_voices(self, provider: ProviderPayload) -> VoiceDiscoveryResult:
        """Soft-probe /audio/voices (non-standard). Strategy remains MANUAL."""
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                response = await client.get(
                    join_url(provider.base_url, "/audio/voices"),
                    headers=self.auth_headers(provider.api_key),
                )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            ) from exc

        if response.status_code in _NO_VOICE_DISCOVERY_STATUS:
            # MANUAL strategy — return soft hints, not authoritative catalog.
            return VoiceDiscoveryResult(
                strategy=self.voice_discovery_strategy,
                mode="FALLBACK",
                voices=list(OPENAI_TTS_HINT_VOICES),
                detail="No live voice catalog; user may enter Voice ID manually",
            )

        raise_for_http_status(response, provider, operation="voice discovery", capability="TTS", log=_prov_log)
        data = response.json()
        raw_voices = data.get("voices", data if isinstance(data, list) else [])
        voices = [
            _voice(
                str(item.get("voice_id") or item.get("id") or item.get("name") or index),
                item.get("display_name") or item.get("name"),
                item.get("language"),
                item.get("gender"),
            )
            for index, item in enumerate(raw_voices)
            if isinstance(item, dict)
        ]
        return VoiceDiscoveryResult(
            strategy=self.voice_discovery_strategy,
            mode="AUTHORITATIVE",
            voices=voices,
            detail=f"{len(voices)} voices from proxy /audio/voices",
        )

    async def discover_models(self, provider: ProviderPayload) -> ModelDiscoveryResult:
        url = join_url(provider.base_url, openai_models_path(provider.base_url).lstrip("/"))
        # openai_models_path already returns absolute path starting with /
        url = provider.base_url.rstrip("/") + openai_models_path(provider.base_url)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=self.auth_headers(provider.api_key))
        except Exception as exc:
            return ModelDiscoveryResult(available=False, detail=f"Model listing unavailable: {exc}")

        if response.status_code != 200:
            return ModelDiscoveryResult(
                available=False,
                detail=f"Model listing returned {response.status_code}",
            )
        try:
            data = response.json()
            models = [
                str(item.get("id"))
                for item in (data.get("data") or [])
                if isinstance(item, dict) and item.get("id")
            ]
            return ModelDiscoveryResult(
                available=True,
                models=models,
                detail=f"{len(models)} models available",
            )
        except Exception:
            return ModelDiscoveryResult(available=True, detail="Model listing endpoint reachable")

    # ── Capability probes ────────────────────────────────────────────────────

    async def validate_capability(
        self,
        provider: ProviderPayload,
        capability: str,
    ) -> ValidationPhaseResult:
        if not self.supports(capability):
            return ValidationPhaseResult(
                ok=False,
                message=f"Protocol {self.protocol} does not support {capability}",
            )
        try:
            if capability == Capability.TEXT.value:
                result = await self.chat(
                    provider,
                    system="You are a connectivity probe.",
                    user="Reply with the single word: OK",
                    max_tokens=8,
                )
                return ValidationPhaseResult(
                    ok=True,
                    message="Chat completion probe successful"
                    + (f": {result.text[:40]}" if result.text else ""),
                )
            if capability == Capability.STT.value:
                # Tiny silent WAV probe is orchestrated by validate_gateway with AudioInput.
                return ValidationPhaseResult(
                    ok=True,
                    message="STT capability declared; use stt-probe for live check",
                )
            if capability == Capability.TTS.value:
                return ValidationPhaseResult(
                    ok=True,
                    message="TTS capability declared; use tts-probe for live check",
                )
        except Exception as exc:
            return ValidationPhaseResult(ok=False, message=str(exc))
        return ValidationPhaseResult(
            ok=False,
            message=f"No capability probe for {capability}",
        )
