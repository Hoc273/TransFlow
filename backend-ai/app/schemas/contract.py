"""Pydantic models mirroring docs/02-data-contract.md.

Field names are snake_case to match the Spring Boot ↔ FastAPI JSON contract.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.error import ProviderErrorDetail


def to_camel(value: str) -> str:
    """snake_case → camelCase (used by ExecutionInfo wire aliases)."""
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)

# Wire protocols — keep in sync with Java ProviderProtocol.
ProviderProtocol = Literal[
    "openai_compatible",
    "anthropic",
    "elevenlabs_native",
    "azure_speech",
    "google_speech",
    "amazon_polly",
    "dashscope_native",
    "local_piper",
]
ProviderCapability = Literal[
    "TEXT",
    "STT",
    "TTS",
    "VISION",
]
Status = Literal["COMPLETED", "FAILED"]
Severity = Literal["critical", "high", "medium", "low"]


class ProviderPayload(BaseModel):
    """Unified BYOK provider config for TEXT/STT/TTS/VISION."""

    protocol: ProviderProtocol
    base_url: str
    api_key: str
    model: str
    temperature: float = 0.2
    # Optional — present for multi-capability providers (esp. TTS). Adapters may ignore.
    capabilities: Optional[set[ProviderCapability]] = None


class GlossaryTerm(BaseModel):
    source: str
    target: str
    case_sensitive: bool = False
    note: Optional[str] = None


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    provider: Optional[str] = None
    model: Optional[str] = None


# ── /ai/translate ────────────────────────────────────────────────────────────
class TranslateRequest(BaseModel):
    request_id: str
    workspace_id: Optional[str] = None
    source_lang: str
    target_lang: str
    source_text: str
    provider: ProviderPayload
    glossary: list[GlossaryTerm] = Field(default_factory=list)
    context: Optional[dict[str, Any]] = None
    options: Optional[dict[str, Any]] = None


class TranslateResponse(BaseModel):
    request_id: str
    status: Status
    translation: Optional[str] = None
    applied_glossary: list[str] = Field(default_factory=list)
    usage: Optional[Usage] = None
    error: Optional[str] = None


# ── /ai/qa ───────────────────────────────────────────────────────────────────
class QARequest(BaseModel):
    request_id: str
    source_lang: str
    target_lang: str
    source_text: str
    translated_text: str
    glossary: list[GlossaryTerm] = Field(default_factory=list)
    provider: ProviderPayload
    checks: list[str] = Field(default_factory=list)


BlockingAction = Literal[
    "BLOCK_EXPORT",
    "BLOCK_RENDER",
]


class QAIssue(BaseModel):
    type: str
    severity: Severity = "medium"
    message: str
    source_span: Optional[str] = None
    target_span: Optional[str] = None
    suggestion: Optional[str] = None
    blocking_actions: list[BlockingAction] = Field(default_factory=list)


class QAResponse(BaseModel):
    request_id: str
    status: Status
    issues: list[QAIssue] = Field(default_factory=list)
    score: Optional[float] = None
    usage: Optional[Usage] = None
    error: Optional[str] = None


# ── /ai/validate-provider ────────────────────────────────────────────────────
class ValidateProviderRequest(BaseModel):
    provider: ProviderPayload


class ValidateProviderResponse(BaseModel):
    ok: bool
    model: Optional[str] = None
    message: Optional[str] = None


# ── /media/stt ──────────────────────────────────────────────────────────────
class SttSegment(BaseModel):
    text: str
    start_ms: int
    end_ms: int
    confidence: Optional[float] = None


class SttUsage(BaseModel):
    audio_seconds: float = 0.0
    provider: Optional[str] = None
    model: Optional[str] = None


class SttRequest(BaseModel):
    correlation_id: str
    media_job_id: str
    audio_ref: str
    audio_url: str
    source_lang: Optional[str] = None
    provider: ProviderPayload
    # STT sanity check (docs/97 §19.15): real duration of the media being
    # transcribed (extracted audio, fallback root asset). Absent for legacy
    # callers → duration rules skipped (no-op), local rules still apply.
    asset_duration_ms: Optional[int] = None


class SttResponse(BaseModel):
    correlation_id: str
    status: Status
    detected_lang: Optional[str] = None
    segments: list[SttSegment] = Field(default_factory=list)
    usage: Optional[SttUsage] = None
    error: Optional[str] = None
    error_detail: Optional[ProviderErrorDetail] = None


# ── /media/summarize ───────────────────────────────────────────────────────
class SummaryCutRange(BaseModel):
    start_ms: int
    end_ms: int


class SummaryProposal(BaseModel):
    proposal_index: int
    cut_ranges: list[SummaryCutRange] = Field(default_factory=list)
    reasoning_note: Optional[str] = None
    total_duration_ms: int
    confidence: Optional[float] = None


class ContentBriefRequest(BaseModel):
    correlation_id: str
    media_job_id: str
    transcript: list[SttSegment] = Field(default_factory=list)
    source_lang: Optional[str] = None
    provider: ProviderPayload


class ContentBriefResponse(BaseModel):
    correlation_id: str
    status: Status
    content_brief: Optional[str] = None
    usage: Optional[Usage] = None
    error: Optional[str] = None
    error_detail: Optional[ProviderErrorDetail] = None


class SummarizeRequest(BaseModel):
    correlation_id: str
    media_job_id: str
    transcript: list[SttSegment] = Field(default_factory=list)
    requested_duration_seconds: int
    duration_tolerance: dict[str, int]
    provider: ProviderPayload


class SummarizeResponse(BaseModel):
    correlation_id: str
    status: Status
    proposals: list[SummaryProposal] = Field(default_factory=list)
    usage: Optional[Usage] = None
    error: Optional[str] = None
    error_detail: Optional[ProviderErrorDetail] = None


# ── /media/summarize/narrative (CT5.2 NARRATIVE_REVIEW, internal) ───────────
class NarrativeSourceRef(BaseModel):
    start_ms: int
    end_ms: int


class NarrativeSectionModel(BaseModel):
    seq: int
    heading: Optional[str] = None
    source_refs: list[NarrativeSourceRef] = Field(default_factory=list)
    script_source_lang: str
    beat_type: Optional[str] = None
    notes: Optional[str] = None
    # TASK 6 additive visual beat fields — text-grounded V1
    visual_description: Optional[str] = None
    visual_strategy: Optional[str] = None
    importance: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    generate_terms: list[str] = Field(default_factory=list)


class NarrativePlanModel(BaseModel):
    title: Optional[str] = None
    target_duration_ms: Optional[int] = None
    sections: list[NarrativeSectionModel] = Field(default_factory=list)
    global_reasoning_note: Optional[str] = None
    confidence: Optional[float] = None
    warnings: list[str] = Field(default_factory=list)


class NarrativeIntentSlice(BaseModel):
    goal_type: str
    tone_style_hints: Optional[str] = None
    target_langs: list[str] = Field(default_factory=list)


class NarrativeSummarizeRequest(BaseModel):
    """Spring → FastAPI wire for C_PLAN NARRATIVE_REVIEW (CT5.2).

    ``content_brief`` is optional additive context from ``POST /media/understand/brief``
    (generative only). Existing callers may omit it; contract shape for required fields
    is unchanged.

    TASK 7 additive (multimodal): ``visual_observations`` / ``visual_scenes`` /
    ``multimodal_context`` are optional visual evidence from ``POST /media/understand/visual``.
    Absent → text-only fallback (TASK 6 behavior). Present → narrative writer MUST ground
    claims in transcript OR visual evidence and hedge low-confidence visuals.
    """

    correlation_id: str
    media_job_id: str
    transcript: list[SttSegment] = Field(default_factory=list)
    language: Optional[str] = None
    duration_ms: int
    intent: NarrativeIntentSlice
    constraints: list[str] = Field(default_factory=list)
    max_sections: Optional[int] = None
    target_duration_ms: Optional[int] = None
    provider: ProviderPayload
    content_brief: Optional[str] = None
    # TASK 7 multimodal additive — optional, backward compatible
    visual_observations: Optional[list[dict]] = None
    visual_scenes: Optional[list[dict]] = None
    multimodal_context: Optional[dict] = None
    # Option A+ additive — cold-start narration pacing estimate (chars/sec) from the
    # bound TTS voice. Same-language jobs only; None preserves the legacy default.
    narration_cps_estimate: Optional[int] = None


class NarrativeSummarizeResponse(BaseModel):
    correlation_id: str
    status: Status
    plans: list[NarrativePlanModel] = Field(default_factory=list)
    usage: Optional[Usage] = None
    error: Optional[str] = None
    error_detail: Optional[ProviderErrorDetail] = None


# ── /media/tts ───────────────────────────────────────────────────────────────
class TtsSegment(BaseModel):
    segment_id: str
    target_text: str


class CacheInfo(BaseModel):
    """Generated Asset Cache status (ADR-CEP §9). A1.2: always a miss (no cache)."""

    hit: bool = False
    source: Optional[str] = None


class ExecutionInfo(BaseModel):
    """Unified per-segment TTS execution metadata (Q-M-TTS-20 / ADR-CEP §9).

    Adapter emits provider/model/voice; the gateway completes latencyMs,
    requestId and cache. Never contains the API key (TC-SEC-01).

    Wire shape is camelCase — ``latency_ms`` → ``latencyMs``,
    ``request_id`` → ``requestId`` (ADR-CEP §9 contract; FastAPI
    response_model serializes with ``by_alias=True``). Python construction
    still accepts the snake_case field names (``populate_by_name``).
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    provider: Optional[str] = None
    model: Optional[str] = None
    voice: Optional[str] = None
    cache: Optional[CacheInfo] = None
    latency_ms: Optional[int] = None
    request_id: Optional[str] = None


class TtsResult(BaseModel):
    segment_id: str
    # Per-segment status per docs/16 §4: SUCCESS | FAILED (not COMPLETED)
    status: Literal["SUCCESS", "FAILED", "COMPLETED"]
    audio_ref: Optional[str] = None
    # Base64 audio payload; Spring Boot uploads to media bucket (C4)
    audio_base64: Optional[str] = None
    error: Optional[str] = None
    # OI-01 (D2.6, `93` §4.19.12): typed per-segment error code — canonical
    # ProviderErrorCode name/value (e.g. "PROVIDER_TTS_VOICE_NOT_FOUND").
    # FAILED typed ProviderException → corresponding code; FAILED generic
    # Exception → PROVIDER_UNKNOWN; SUCCESS → absent/null. Human-readable
    # detail stays in `error`. Never carries retryability (Spring derives
    # nothing from it — caller-supplied retryable stays authoritative).
    errorCode: Optional[str] = None
    # Additive runtime observability (A1.2); absent for legacy/mock flows.
    execution_info: Optional[ExecutionInfo] = None


class TtsUsage(BaseModel):
    characters: int = 0
    provider: Optional[str] = None


class TtsRequest(BaseModel):
    correlation_id: str
    media_job_id: str
    voice_id: str
    segments: list[TtsSegment] = Field(default_factory=list)
    provider: ProviderPayload

    @field_validator("provider")
    @classmethod
    def require_tts_when_capabilities_present(cls, provider: ProviderPayload) -> ProviderPayload:
        # Soft check: only enforce when caller declares capabilities.
        if provider.capabilities is not None and "TTS" not in provider.capabilities:
            raise ValueError("TTS request provider.capabilities must include TTS")
        return provider


class TtsResponse(BaseModel):
    correlation_id: str
    status: Status
    results: list[TtsResult] = Field(default_factory=list)
    usage: Optional[TtsUsage] = None
    error: Optional[str] = None


class TtsVoice(BaseModel):
    voice_id: str
    language: str
    # All languages this voice is compatible with (normalized primary codes,
    # e.g. ["en", "vi"] for a multilingual voice). None/absent → Spring derives
    # [language] so legacy payloads keep working. ``language`` stays the first
    # entry (primary display language) for backward-compatible ordering/index.
    languages: Optional[list[str]] = None
    # Unknown gender (e.g. Piper vi models, MODEL_CARD does not publish it) = None.
    gender: Optional[Literal["MALE", "FEMALE"]] = None
    display_name: str


class TtsVoicesResponse(BaseModel):
    protocol: str
    # AUTHORITATIVE = live API list; STATIC = preset catalog; FALLBACK = soft hints;
    # UNAVAILABLE = no catalog (MANUAL strategy).
    discovery_mode: Literal["AUTHORITATIVE", "STATIC", "FALLBACK", "UNAVAILABLE"]
    voices: list[TtsVoice] = Field(default_factory=list)
    # How the UI should obtain voices for this protocol (AUTO/STATIC/MANUAL/UNSUPPORTED).
    voice_discovery_strategy: Literal["AUTO", "STATIC", "MANUAL", "UNSUPPORTED"] | None = None
