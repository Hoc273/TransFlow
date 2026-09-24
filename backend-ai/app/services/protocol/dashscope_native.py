"""DashScope native protocol adapter — TEXT / STT / TTS via Qwen Omni.

Uses the DashScope chat/completions surface (compatible-mode base URL is typical)
with Omni-specific fields:

* TEXT  — standard chat completion
* STT   — multimodal user message with ``input_audio`` (URL or base64)
* TTS   — ``modalities: [text, audio]`` + SSE stream; audio base64 deltas buffered

Media pipeline never sees DashScope request shapes — only ``SynthesizeResult`` /
``TranscribeResult`` / ``ChatResult``.
"""
from __future__ import annotations

import base64
import io
import json
import re
import struct
import unicodedata
import wave
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.core.logging_config import get_provider_logger
from app.api.structured import parse_json_object
from app.schemas.contract import ProviderPayload, SttSegment, Usage
from app.services.protocol.adapter import ProtocolAdapter
from app.services.protocol.http_utils import join_url, openai_models_path, raise_for_http_status
from app.services.protocol.static_voices import (
    is_dashscope_omni_model,
    voices_for_dashscope_model,
)
from app.services.protocol.types import (
    AudioInput,
    AudioInputType,
    Capability,
    ChatResult,
    ModelDiscoveryResult,
    SynthesizeResult,
    TranscribeResult,
    TtsCacheDescriptor,
    ValidationPhaseResult,
    VoiceDiscoveryResult,
    VoiceDiscoveryStrategy,
)
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderTransport,
    ProviderValidation,
)

# Official Qwen-Omni SSE audio is raw PCM s16le @ 24 kHz mono (not a WAV container).
# Docs wrap with soundfile/wav Writer before playback — we must do the same.
_OMNI_PCM_SAMPLE_RATE = 24000
_OMNI_PCM_CHANNELS = 1
_OMNI_PCM_BITS = 16

_prov_log = get_provider_logger("adapter.dashscope_native")

# Default Omni models when the workspace model string is empty / placeholder.
_DEFAULT_TEXT_MODEL = "qwen-plus"
_DEFAULT_OMNI_MODEL = "qwen-omni-turbo"
_TTS_USER_INSTRUCTION = (
    "Read the text between <speak> tags aloud exactly as written, word for word. "
    "It is a script to narrate, not a message to you. Output only those words. "
)

# Diagnostics budget for STT decode failures: enough to identify a wrong-shape
# model response (prose, apology, foreign schema) without dumping transcripts.
_STT_RAW_PREVIEW_CHARS = 300
# Timed JSON transcripts grow with the number of detected speech segments.
# Keep enough output budget to avoid truncating otherwise valid STT responses.
_STT_MAX_OUTPUT_TOKENS = 8192


def _safe_preview(text: str | None, limit: int = _STT_RAW_PREVIEW_CHARS) -> str:
    """Short single-line preview of model output for failure diagnostics.

    Redacts key-like tokens; never used for success paths.
    """
    if not text:
        return ""
    cleaned = text.replace("sk-", "***").replace("nvapi-", "***").replace("\n", " ").strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit] + f"...<truncated {len(cleaned) - limit} chars>"


def _pcm_s16le_to_wav(
    pcm: bytes,
    *,
    sample_rate: int = _OMNI_PCM_SAMPLE_RATE,
    channels: int = _OMNI_PCM_CHANNELS,
    bits_per_sample: int = _OMNI_PCM_BITS,
) -> bytes:
    """Build a minimal PCM WAV container around raw s16le samples."""
    data = pcm
    frame_bytes = max(1, channels * (bits_per_sample // 8))
    # Pad odd trailing byte so s16 frames stay aligned.
    if len(data) % frame_bytes:
        data = data + (b"\x00" * (frame_bytes - (len(data) % frame_bytes)))
    data_size = len(data)
    byte_rate = sample_rate * channels * (bits_per_sample // 8)
    block_align = channels * (bits_per_sample // 8)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    return header + data


class DashScopeNativeAdapter(ProtocolAdapter):
    protocol = "dashscope_native"
    supported_capabilities = frozenset({
        Capability.TEXT.value,
        Capability.STT.value,
        Capability.TTS.value,
    })
    voice_discovery_strategy = VoiceDiscoveryStrategy.STATIC
    # Serena works on both qwen-omni-turbo and qwen3.5-omni-* (Cherry does not on 3.5).
    default_probe_voice = "Serena"

    def prefers_audio_url(self) -> bool:
        # DashScope Omni accepts remote audio_url / data URI without multipart upload.
        return True

    # ── Auth ─────────────────────────────────────────────────────────────────

    def auth_headers(self, api_key: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def auth_probe_path(self, base_url: str) -> str:
        # Compatible-mode exposes /models; native generation root may 404 → soft-pass.
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
            return {"enable_thinking": False}
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
        if images:
            self.require_provider_capability(provider, Capability.VISION)
        self.require_provider_capability(provider, Capability.TEXT)
        model = provider.model or _DEFAULT_TEXT_MODEL
        url = join_url(provider.base_url, "/chat/completions")
        payload: dict[str, Any] = {
            "model": model,
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
            merged = {**extra_body, **payload}
            payload.clear()
            payload.update(merged)
        try:
            async with httpx.AsyncClient(timeout=settings.text_request_timeout_seconds) as client:
                resp = await client.post(
                    url,
                    headers=self.auth_headers(provider.api_key),
                    json=payload,
                )
                if self._should_retry_without_enable_thinking(resp, payload):
                    fallback_payload = dict(payload)
                    fallback_payload.pop("enable_thinking", None)
                    _prov_log.info(
                        "DashScope model rejected enable_thinking; retrying once without it",
                        extra={
                            "protocol": self.protocol,
                            "capability": "TEXT",
                            "model": model,
                            "vendorStatus": resp.status_code,
                        },
                    )
                    resp = await client.post(
                        url,
                        headers=self.auth_headers(provider.api_key),
                        json=fallback_payload,
                    )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TEXT",
            ) from exc

        raise_for_http_status(resp, provider, operation="chat", capability="TEXT", log=_prov_log)
        data = resp.json()
        text = self._extract_text(data)
        u = data.get("usage") or {}
        # DashScope OpenAI-compat envelope exposes choices[0].finish_reason;
        # native envelope exposes output.finish_reason. Fall back to "stop".
        finish_reason = "stop"
        choices = data.get("choices") or []
        if choices and isinstance(choices[0], dict):
            finish_reason = choices[0].get("finish_reason") or "stop"
        else:
            output = data.get("output") or {}
            if isinstance(output, dict):
                finish_reason = output.get("finish_reason") or "stop"
        return ChatResult(
            text=text,
            usage=Usage(
                input_tokens=u.get("prompt_tokens", 0) or u.get("input_tokens", 0),
                output_tokens=u.get("completion_tokens", 0) or u.get("output_tokens", 0),
                provider=self.protocol,
                model=model,
            ),
            finish_reason=finish_reason,
        )

    @staticmethod
    def _should_retry_without_enable_thinking(
        response: httpx.Response,
        payload: dict[str, Any],
    ) -> bool:
        """Detect the narrow DashScope error for models without this control."""
        if "enable_thinking" not in payload or response.status_code != 400:
            return False
        try:
            detail = (response.text or "").casefold()
        except Exception:
            return False
        if "enable_thinking" not in detail:
            return False
        unsupported_markers = (
            "not support",
            "unsupported",
            "invalid parameter",
            "invalid_parameter",
            "invalidparameter",
            "unknown parameter",
            "unrecognized parameter",
            "not allowed",
        )
        return any(marker in detail for marker in unsupported_markers)

    # ── STT (Qwen Omni multimodal) ───────────────────────────────────────────

    async def transcribe(
        self,
        provider: ProviderPayload,
        audio: AudioInput,
        *,
        source_lang: Optional[str] = None,
    ) -> TranscribeResult:
        self.require_provider_capability(provider, Capability.STT)
        model = provider.model or _DEFAULT_OMNI_MODEL
        url = join_url(provider.base_url, "/chat/completions")

        audio_part = self._build_input_audio_part(audio)
        lang_hint = (
            f" The caller has explicitly set the source language to {source_lang!r}; "
            "return that value as detected_lang."
            if source_lang
            else " Detect the primary spoken language and return its BCP-47/ISO code."
        )
        # Qwen-Omni requires stream=True for all requests (official docs).
        payload = {
            "model": model,
            "max_tokens": _STT_MAX_OUTPUT_TOKENS,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        audio_part,
                        {
                            "type": "text",
                            "text": (
                                "Transcribe the audio verbatim into sentence-level timed segments. "
                                "Return ONLY strict JSON with this shape: "
                                '{"detected_lang":"en","segments":['
                                '{"text":"...","start_ms":0,"end_ms":1250}]}. '
                                "Every non-empty sentence must have real millisecond timestamps; "
                                "end_ms must be greater than start_ms and segments must be monotonic. "
                                "Inspect the complete supplied audio through the end; do not stop merely "
                                "because music, an ending theme, or credits begin. If intelligible speech "
                                "resumes later, include those later timed segments. Do not fabricate speech "
                                "for music-only or credits. "
                                "Never emit a placeholder 0-to-0 segment and never add commentary."
                                + lang_hint
                            ),
                        },
                    ],
                }
            ],
            "modalities": ["text"],
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        headers = {
            **self.auth_headers(provider.api_key),
            "Accept": "text/event-stream",
        }

        text_parts: list[str] = []
        done_seen = False
        finish_reason: str | None = None
        try:
            async with httpx.AsyncClient(
                timeout=max(settings.request_timeout_seconds, 600.0)
            ) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers=headers,
                    json=payload,
                ) as response:
                    if response.status_code >= 400:
                        body = await response.aread()
                        fake = httpx.Response(
                            response.status_code,
                            content=body,
                            request=response.request,
                        )
                        raise_for_http_status(
                            fake,
                            provider,
                            operation="transcription",
                            capability="STT",
                            log=_prov_log,
                        )
                    async for line in response.aiter_lines():
                        event_done, event_finish_reason = self._parse_sse_terminal_line(line)
                        done_seen = done_seen or event_done
                        if event_finish_reason:
                            finish_reason = event_finish_reason
                        chunk_text = self._parse_sse_text_line(line)
                        if chunk_text:
                            text_parts.append(chunk_text)
        except ProviderValidation:
            raise
        except ProviderTransport:
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            ) from exc
        except Exception as exc:
            from app.services.provider_errors import ProviderException

            if isinstance(exc, ProviderException):
                raise
            raise ProviderValidation(
                f"DashScope STT SSE failed: {exc}",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            ) from exc

        response_text = "".join(text_parts).strip()
        terminal_seen = done_seen or finish_reason is not None
        if finish_reason == "length":
            self._raise_incomplete_stt_stream(
                provider,
                model=model,
                response_text=response_text,
                terminal_seen=terminal_seen,
                finish_reason=finish_reason,
                reason="provider output limit reached",
            )
        if finish_reason not in (None, "stop"):
            self._raise_incomplete_stt_stream(
                provider,
                model=model,
                response_text=response_text,
                terminal_seen=terminal_seen,
                finish_reason=finish_reason,
                reason="provider ended without a successful STT finish reason",
            )
        if not terminal_seen:
            self._raise_incomplete_stt_stream(
                provider,
                model=model,
                response_text=response_text,
                terminal_seen=False,
                finish_reason=None,
                reason="SSE transport reached EOF before a terminal event",
            )
        if not response_text:
            raise ProviderValidation(
                "DashScope STT returned empty transcript",
                code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            )

        segments, detected_lang = self._decode_timed_transcript(
            response_text,
            source_lang=source_lang,
            provider=provider,
            finish_reason=finish_reason,
        )
        return TranscribeResult(
            segments=segments,
            detected_lang=detected_lang,
            audio_seconds=segments[-1].end_ms / 1000.0 if segments else 0.0,
            metadata={"model": model, "provider": self.protocol, "transport": "sse"},
        )

    @staticmethod
    def _strip_fence(text: str) -> str:
        cleaned = text.strip()
        if not cleaned.startswith("```"):
            return cleaned
        lines = cleaned.splitlines()[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        return "\n".join(lines).strip()

    @staticmethod
    def _looks_like_segment(item: Any) -> bool:
        return (
            isinstance(item, dict)
            and isinstance(item.get("text"), str)
            and isinstance(item.get("start_ms"), int)
            and not isinstance(item.get("start_ms"), bool)
            and isinstance(item.get("end_ms"), int)
            and not isinstance(item.get("end_ms"), bool)
        )

    def _extract_transcript_shape(
        self, response_text: str, *, provider: ProviderPayload,
        finish_reason: str | None = None,
    ) -> tuple[Any, str, str]:
        """Extract (segments, envelope_lang, shape) from model output.

        Accepted shapes: ``{"detected_lang","segments"}`` envelope and bare
        top-level segment arrays (fenced or not). Truncated JSON is never
        salvaged into a successful transcript.
        """
        cleaned = self._strip_fence(response_text)
        try:
            top = json.loads(cleaned)
        except json.JSONDecodeError:
            top = None
        if isinstance(top, list):
            return top, "", "array"
        if isinstance(top, dict):
            return top.get("segments"), str(top.get("detected_lang") or ""), (
                f"envelope keys={sorted(top.keys())}"
            )
        try:
            payload = parse_json_object(response_text)
        except ValueError as exc:
            _prov_log.warning(
                "DashScope STT non-JSON transcript model=%s response_len=%d preview=%r",
                getattr(provider, "model", None),
                len(response_text),
                _safe_preview(response_text),
                extra={"protocol": self.protocol, "capability": "STT"},
            )
            raise ProviderValidation(
                "DashScope STT did not return the required timed JSON transcript "
                f"(response_len={len(response_text)}; check that the STT model "
                "supports audio input and JSON output)",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            ) from exc
        if isinstance(payload.get("segments"), list):
            return payload.get("segments"), str(payload.get("detected_lang") or ""), (
                f"envelope keys={sorted(payload.keys())}"
            )
        # Recover complete segment objects only for safe diagnostics. Partial
        # output must remain retryable and can never become a successful STT.
        from app.api.structured import _all_balanced_objects

        salvaged = []
        for span in _all_balanced_objects(response_text):
            try:
                candidate = json.loads(span)
            except json.JSONDecodeError:
                continue
            if self._looks_like_segment(candidate):
                salvaged.append(candidate)
        if salvaged:
            _prov_log.warning(
                "DashScope STT detected %d complete segments in partial output model=%s "
                "finish_reason=%s response_len=%d",
                len(salvaged),
                getattr(provider, "model", None),
                finish_reason,
                len(response_text),
                extra={"protocol": self.protocol, "capability": "STT"},
            )
            raise ProviderValidation(
                "DashScope STT returned incomplete JSON "
                f"(partial_segments_detected={len(salvaged)}, finish_reason={finish_reason}, "
                f"response_len={len(response_text)})",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            )
        return None, str(payload.get("detected_lang") or ""), (
            f"envelope keys={sorted(payload.keys())}"
        )

    def _decode_timed_transcript(
        self,
        response_text: str,
        *,
        source_lang: Optional[str],
        provider: ProviderPayload,
        finish_reason: str | None = None,
    ) -> tuple[list[SttSegment], str]:
        # qwen-omni variants do not always honor the envelope contract: observed
        # complete shapes include a bare top-level array of segments (fenced or
        # not). Truncated output is rejected so the existing STT retry can rerun.
        raw_segments, envelope_lang, shape = self._extract_transcript_shape(
            response_text, provider=provider, finish_reason=finish_reason,
        )

        detected_lang = (source_lang or envelope_lang or "").strip()
        if not isinstance(raw_segments, list) or (not detected_lang and raw_segments):
            _prov_log.warning(
                "DashScope STT wrong-shape transcript model=%s response_len=%d "
                "shape=%s preview=%r",
                getattr(provider, "model", None),
                len(response_text),
                shape,
                _safe_preview(response_text),
                extra={"protocol": self.protocol, "capability": "STT"},
            )
            raise ProviderValidation(
                "DashScope STT response requires detected_lang and timed segments "
                f"(got shape={shape}, response_len={len(response_text)}; "
                "check that the STT model supports audio input and JSON output)",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            )
        if not raw_segments:
            # Valid JSON with an explicit empty transcript — the model concluded
            # The adapter successfully confirmed no speech; callers may merge
            # this empty result with other audio chunks.
            return [], detected_lang

        segments: list[SttSegment] = []
        previous_start = -1
        for index, item in enumerate(raw_segments):
            if not isinstance(item, dict):
                _prov_log.warning(
                    "DashScope STT dropping non-object segment %d",
                    index,
                    extra={"protocol": self.protocol, "capability": "STT"},
                )
                continue
            text = str(item.get("text") or "").strip()
            start_ms = item.get("start_ms")
            end_ms = item.get("end_ms")
            if (
                not text
                or isinstance(start_ms, bool)
                or isinstance(end_ms, bool)
                or not isinstance(start_ms, int)
                or not isinstance(end_ms, int)
                or start_ms < 0
                or end_ms <= start_ms
            ):
                _prov_log.warning(
                    "DashScope STT dropping invalid segment %d (%r, start=%r, end=%r)",
                    index, text[:40], start_ms, end_ms,
                    extra={"protocol": self.protocol, "capability": "STT"},
                )
                continue
            # Qwen-Omni is LLM-based and occasionally emits a segment whose start
            # falls before the previous segment (non-monotonic). Clamp instead of
            # failing the whole transcript — the timeline stays valid downstream.
            if start_ms < previous_start:
                _prov_log.warning(
                    "DashScope STT clamping non-monotonic segment %d start %d -> %d",
                    index, start_ms, previous_start,
                    extra={"protocol": self.protocol, "capability": "STT"},
                )
                start_ms = previous_start
                if end_ms <= start_ms:
                    continue
            confidence = item.get("confidence")
            segments.append(SttSegment(
                text=text,
                start_ms=start_ms,
                end_ms=end_ms,
                confidence=confidence if isinstance(confidence, (int, float)) else None,
            ))
            previous_start = start_ms
        if not segments:
            raise ProviderValidation(
                "DashScope STT returned no usable timed segments",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="STT",
            )
        return segments, detected_lang

    def _build_input_audio_part(self, audio: AudioInput) -> dict[str, Any]:
        """Build DashScope ``input_audio`` part.

        Official Qwen-Omni contract for ``input_audio.data``:
        * public HTTPS URL, or
        * data URI ``data:;base64,<payload>`` (raw base64 is treated as a URL
          and fails with ``InternalError.Algo.InvalidParameter``).
        """
        fmt = self._audio_format(audio)

        if audio.type == AudioInputType.URL and audio.url:
            return {
                "type": "input_audio",
                "input_audio": {"data": audio.url, "format": fmt},
            }

        # Local bytes / file / base64 → data URI (required by DashScope)
        if audio.type == AudioInputType.BASE64 and audio.base64_data:
            b64 = audio.base64_data.strip()
            # Accept callers that already send a data URI
            if b64.startswith("data:"):
                data_uri = b64
            else:
                data_uri = f"data:;base64,{b64}"
        else:
            try:
                raw = audio.as_bytes()
            except ValueError as exc:
                raise ProviderValidation(
                    "DashScope STT requires audio URL or binary payload",
                    code=ProviderErrorCode.PROVIDER_BAD_REQUEST,
                    protocol=self.protocol,
                    capability="STT",
                ) from exc
            data_uri = f"data:;base64,{base64.b64encode(raw).decode('ascii')}"

        return {
            "type": "input_audio",
            "input_audio": {"data": data_uri, "format": fmt},
        }

    @staticmethod
    def _audio_format(audio: AudioInput) -> str:
        if audio.mime_type:
            mime = audio.mime_type.lower()
            if "mpeg" in mime or "mp3" in mime:
                return "mp3"
            if "wav" in mime:
                return "wav"
            if "ogg" in mime:
                return "ogg"
            if "aac" in mime:
                return "aac"
        name = (audio.filename or "").lower()
        if name.endswith(".mp3"):
            return "mp3"
        if name.endswith(".ogg"):
            return "ogg"
        if name.endswith(".aac"):
            return "aac"
        if audio.url:
            path = audio.url.split("?", 1)[0].lower()
            if path.endswith(".mp3"):
                return "mp3"
            if path.endswith(".ogg"):
                return "ogg"
            if path.endswith(".aac"):
                return "aac"
        return "wav"

    @staticmethod
    def _parse_sse_text_line(line: str) -> str | None:
        """Extract text delta from an SSE ``data:`` line (STT / text modalities)."""
        if not line:
            return None
        raw = line.strip()
        if raw.startswith("data:"):
            raw = raw[5:].strip()
        if not raw or raw == "[DONE]":
            return None
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            return None

        choices = event.get("choices") or []
        if not choices:
            return None
        choice = choices[0]
        # Streaming chunks use delta; final/non-stream shapes use message
        for key in ("delta", "message"):
            part = choice.get(key) or {}
            content = part.get("content")
            if isinstance(content, str) and content:
                return content
            if isinstance(content, list):
                texts = []
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        texts.append(item.get("text") or "")
                    elif isinstance(item, str):
                        texts.append(item)
                joined = "".join(texts)
                if joined:
                    return joined
        return None

    @staticmethod
    def _parse_sse_terminal_line(line: str) -> tuple[bool, str | None]:
        """Return ``([DONE] seen, finish_reason)`` for one SSE data line."""
        if not line:
            return False, None
        raw = line.strip()
        if raw.startswith("data:"):
            raw = raw[5:].strip()
        if raw == "[DONE]":
            return True, None
        if not raw:
            return False, None
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            return False, None
        choices = event.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            return False, None
        finish_reason = choices[0].get("finish_reason")
        return False, str(finish_reason) if finish_reason else None

    def _raise_incomplete_stt_stream(
        self,
        provider: ProviderPayload,
        *,
        model: str,
        response_text: str,
        terminal_seen: bool,
        finish_reason: str | None,
        reason: str,
    ) -> None:
        partial_count, last_end_ms = self._partial_transcript_diagnostics(response_text)
        _prov_log.warning(
            "DashScope STT incomplete stream model=%s protocol=%s terminal_seen=%s "
            "finish_reason=%s response_len=%d partial_segments_detected=%d "
            "last_segment_end_ms=%s asset_duration_ms=%s reason=%s",
            model,
            self.protocol,
            terminal_seen,
            finish_reason,
            len(response_text),
            partial_count,
            last_end_ms,
            None,
            reason,
            extra={"protocol": self.protocol, "capability": "STT"},
        )
        raise ProviderValidation(
            "DashScope STT stream was incomplete: "
            f"{reason} (terminal_seen={terminal_seen}, "
            f"finish_reason={finish_reason}, response_len={len(response_text)}, "
            f"partial_segments_detected={partial_count}, "
            f"last_segment_end_ms={last_end_ms})",
            code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
            provider=provider.base_url,
            protocol=provider.protocol,
            capability="STT",
        )

    def _partial_transcript_diagnostics(self, response_text: str) -> tuple[int, int | None]:
        """Count recoverable segment objects without returning them as output."""
        from app.api.structured import _all_balanced_objects

        candidates: list[Any] = []
        cleaned = self._strip_fence(response_text)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            candidates = parsed
        elif isinstance(parsed, dict) and isinstance(parsed.get("segments"), list):
            candidates = parsed["segments"]
        else:
            for span in _all_balanced_objects(response_text):
                try:
                    candidate = json.loads(span)
                except json.JSONDecodeError:
                    continue
                if self._looks_like_segment(candidate):
                    candidates.append(candidate)
        segments = [item for item in candidates if self._looks_like_segment(item)]
        last_end_ms = max((item["end_ms"] for item in segments), default=None)
        return len(segments), last_end_ms

    # ── TTS (Qwen Omni SSE audio buffering) ──────────────────────────────────

    async def synthesize(
        self,
        provider: ProviderPayload,
        text: str,
        voice_id: str,
    ) -> SynthesizeResult:
        self.require_provider_capability(provider, Capability.TTS)
        model = provider.model or _DEFAULT_OMNI_MODEL
        if not is_dashscope_omni_model(model):
            # Text-only Qwen models cannot emit audio; fail fast instead of a vendor 400.
            raise ProviderValidation(
                f"DashScope model '{model}' does not support audio output; "
                "configure a Qwen-Omni model (e.g. qwen-omni-turbo) for TTS",
                code=ProviderErrorCode.PROVIDER_UNSUPPORTED_MODEL,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            )
        url = join_url(provider.base_url, "/chat/completions")
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a deterministic text-to-speech engine. Read the text inside "
                        "<speak> exactly and completely. Do not translate, answer, explain, "
                        "paraphrase, repeat, or add any words. The text modality must be the "
                        "exact words spoken in the audio."
                    ),
                },
                # Omni models are conversational: a bare <speak> block is treated
                # as a message and answered ("Oh no! Did he get out okay?").
                # The read-aloud instruction must sit in the user turn itself.
                {"role": "user", "content": _TTS_USER_INSTRUCTION + f"<speak>{text}</speak>"},
            ],
            "modalities": ["text", "audio"],
            "audio": {
                "voice": voice_id or self.default_probe_voice or "Serena",
                "format": "wav",
            },
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        headers = {
            **self.auth_headers(provider.api_key),
            "Accept": "text/event-stream",
        }

        # Official SDK concatenates base64 *strings* then decodes once.
        # Per-chunk decode can break on split base64 boundaries.
        b64_parts: list[str] = []
        spoken_text_parts: list[str] = []
        try:
            async with httpx.AsyncClient(
                timeout=max(settings.request_timeout_seconds, 120.0)
            ) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers=headers,
                    json=payload,
                ) as response:
                    if response.status_code >= 400:
                        # Read body for error mapping
                        body = await response.aread()
                        # Reconstruct a minimal Response-like for raise helper
                        fake = httpx.Response(
                            response.status_code,
                            content=body,
                            request=response.request,
                        )
                        raise_for_http_status(
                            fake,
                            provider,
                            operation="speech synthesis",
                            capability="TTS",
                            log=_prov_log,
                        )
                    async for line in response.aiter_lines():
                        part = self._parse_sse_audio_b64(line)
                        if part:
                            b64_parts.append(part)
                        spoken_text = (
                            self._parse_sse_audio_transcript(line)
                            or self._parse_sse_text_line(line)
                        )
                        if spoken_text:
                            spoken_text_parts.append(spoken_text)
        except ProviderValidation:
            raise
        except ProviderTransport:
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTransport(
                str(exc),
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            ) from exc
        except Exception as exc:
            # Re-raise structured errors; wrap unknowns
            from app.services.provider_errors import ProviderException

            if isinstance(exc, ProviderException):
                raise
            raise ProviderValidation(
                f"DashScope TTS SSE failed: {exc}",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            ) from exc

        if not b64_parts:
            raise ProviderValidation(
                "DashScope TTS returned no audio in SSE stream",
                code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            )

        try:
            raw_audio = base64.b64decode("".join(b64_parts))
        except Exception as exc:
            raise ProviderValidation(
                f"DashScope TTS returned invalid base64 audio: {exc}",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            ) from exc

        if not raw_audio:
            raise ProviderValidation(
                "DashScope TTS decoded to empty audio",
                code=ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            )

        # Vendor returns raw PCM s16le despite format=wav; wrap into a real WAV.
        wav_bytes = self._ensure_wav_container(raw_audio)
        spoken_text = "".join(spoken_text_parts).strip()
        if not spoken_text or self._normalize_spoken_text(spoken_text) != self._normalize_spoken_text(text):
            raise ProviderValidation(
                "DashScope audio generation did not read the requested text verbatim",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            )
        duration_seconds = self._wav_duration_seconds(wav_bytes)
        max_reasonable_seconds = self._max_reasonable_speech_seconds(text)
        if duration_seconds > max_reasonable_seconds:
            raise ProviderValidation(
                "DashScope audio duration is inconsistent with the requested TTS text",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="TTS",
            )
        return SynthesizeResult(
            audio_bytes=wav_bytes,
            mime_type="audio/wav",
            metadata={
                "format": "wav",
                "voice": voice_id,
                "model": model,
                "transport": "sse",
                "sample_rate": _OMNI_PCM_SAMPLE_RATE,
                "channels": _OMNI_PCM_CHANNELS,
                "duration_seconds": duration_seconds,
            },
        )

    def cache_descriptor(
        self,
        provider: ProviderPayload,
        voice_id: str,
    ) -> TtsCacheDescriptor:
        """Cache key material for DashScope Omni: WAV output, resolved model.

        Mirrors ``synthesize`` field resolution (``provider.model`` with the
        Omni fallback); voice is passed through verbatim like the engine does.
        Pure, no I/O.
        """
        return TtsCacheDescriptor(
            resolved_model=provider.model or _DEFAULT_OMNI_MODEL,
            mime_type="audio/wav",
            extension="wav",
            speed="1.0",
        )

    @staticmethod
    def _normalize_spoken_text(value: str) -> str:
        normalized = unicodedata.normalize("NFKC", value).casefold()
        return re.sub(r"[^\w]+", "", normalized, flags=re.UNICODE)

    @staticmethod
    def _wav_duration_seconds(wav_bytes: bytes) -> float:
        try:
            with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
                frame_rate = wav_file.getframerate()
                if frame_rate <= 0:
                    raise ValueError("invalid WAV sample rate")
                return wav_file.getnframes() / float(frame_rate)
        except (wave.Error, EOFError, ValueError) as exc:
            raise ProviderValidation(
                "DashScope TTS returned an invalid WAV payload",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                protocol="dashscope_native",
                capability="TTS",
            ) from exc

    @staticmethod
    def _max_reasonable_speech_seconds(text: str) -> float:
        words = re.findall(r"\w+", text, flags=re.UNICODE)
        non_space_chars = len(re.sub(r"\s+", "", text))
        expected_seconds = max(1.0, len(words) / 2.0, non_space_chars / 12.0)
        return max(15.0, expected_seconds * 2.5 + 5.0)

    @staticmethod
    def _parse_sse_audio_transcript(line: str) -> str | None:
        """Extract the transcript carried beside an Omni audio delta."""
        if not line:
            return None
        raw = line.strip()
        if raw.startswith("data:"):
            raw = raw[5:].strip()
        if not raw or raw == "[DONE]":
            return None
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            return None
        choices = event.get("choices") or []
        if not choices:
            return None
        for key in ("delta", "message"):
            audio = (choices[0].get(key) or {}).get("audio")
            if isinstance(audio, dict):
                transcript = audio.get("transcript") or audio.get("text")
                if isinstance(transcript, str) and transcript:
                    return transcript
        return None

    @staticmethod
    def _parse_sse_audio_b64(line: str) -> str | None:
        """Extract base64 audio delta string from an SSE ``data:`` line."""
        if not line:
            return None
        raw = line.strip()
        if raw.startswith("data:"):
            raw = raw[5:].strip()
        if not raw or raw == "[DONE]":
            return None
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            return None

        # OpenAI-compatible omni stream shapes:
        # choices[0].delta.audio.data  OR  choices[0].delta.audio (string)
        choices = event.get("choices") or []
        if not choices:
            return None
        delta = choices[0].get("delta") or {}
        audio = delta.get("audio")
        if audio is None:
            # Some builds put audio on the message object of the final chunk
            message = choices[0].get("message") or {}
            audio = message.get("audio")
        if audio is None:
            return None

        if isinstance(audio, str):
            return audio or None
        if isinstance(audio, dict):
            b64 = audio.get("data") or audio.get("audio")
            return b64 if isinstance(b64, str) and b64 else None
        return None

    @staticmethod
    def _ensure_wav_container(raw: bytes) -> bytes:
        """Wrap raw Omni PCM as a standard WAV, or pass through if already RIFF/WAVE."""
        if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
            return raw
        return _pcm_s16le_to_wav(raw)

    # ── Discovery ────────────────────────────────────────────────────────────

    async def discover_voices(self, provider: ProviderPayload) -> VoiceDiscoveryResult:
        """STATIC strategy — model-family catalog (turbo / 3.5 / flash)."""
        voices = voices_for_dashscope_model(provider.model)
        return VoiceDiscoveryResult(
            strategy=self.voice_discovery_strategy,
            mode="STATIC",
            voices=voices,
            detail=f"{len(voices)} static Qwen Omni voices for model={provider.model or _DEFAULT_OMNI_MODEL}",
        )

    async def discover_models(self, provider: ProviderPayload) -> ModelDiscoveryResult:
        url = provider.base_url.rstrip("/") + openai_models_path(provider.base_url)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    url, headers=self.auth_headers(provider.api_key)
                )
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

    # ── Capability probe ─────────────────────────────────────────────────────

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
            if capability in (Capability.STT.value, Capability.TTS.value):
                return ValidationPhaseResult(
                    ok=True,
                    message=f"{capability} capability declared; use capability probe for live check",
                )
        except Exception as exc:
            return ValidationPhaseResult(ok=False, message=str(exc))
        return ValidationPhaseResult(ok=False, message=f"No probe for {capability}")

    # ── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_text(data: dict) -> str:
        choices = data.get("choices") or []
        if not choices:
            # Native DashScope envelope: output.choices / output.text
            output = data.get("output") or {}
            if isinstance(output.get("text"), str):
                text = output["text"].strip()
                if text:
                    return text
            choices = output.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or choices[0].get("delta") or {}
        content = message.get("content")
        if isinstance(content, str):
            text = content.strip()
            if text:
                return text
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    parts.append(part.get("text") or "")
                elif isinstance(part, str):
                    parts.append(part)
            text = "".join(parts).strip()
            if text:
                return text
        reasoning = message.get("reasoning_content")
        if isinstance(reasoning, str) and reasoning.strip():
            return reasoning.strip()
        return ""
