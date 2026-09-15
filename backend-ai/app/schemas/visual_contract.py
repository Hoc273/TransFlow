"""Visual Understanding V1 contracts (TASK 7 — MULTIMODAL VISUAL UNDERSTANDING).

Mirrors the Java domain visual records; wire names are snake_case to match
Spring ↔ FastAPI contract (docs/16). No hard-coded provider — goes through
CEP/ProviderPayload abstraction (docs/93).

VisualObservation schema (requirement 2):
{
  timestamp, sceneId, people, objects, location, action, text, visualDescription, confidence
}
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.contract import ProviderPayload
from app.schemas.error import ProviderErrorDetail

# ── Core observation ─────────────────────────────────────────────────

class VisualObservation(BaseModel):
    """Atomic visual understanding unit — one sampled frame.

    * timestamp  — frame center in ms on source timeline
    * sceneId    — scene identifier (scene-001 …) derived from grouping; may be null for raw VLM output
    * people     — number of people detected (0 = empty scene)
    * objects    — salient objects/tags (e.g. ["table","microphone"])
    * location   — inferred location / setting (e.g. "outdoor street at night")
    * action     — main action in frame (e.g. "two people fighting")
    * text       — visible OCR/text in frame (nullable)
    * visualDescription — 1-2 sentence dense description (VLM raw)
    * confidence — VLM confidence 0..1 (low → do not assert strong facts)
    """

    model_config = ConfigDict(extra="forbid")

    timestamp: int = Field(ge=0, description="frame timestamp ms on source timeline")
    scene_id: Optional[str] = Field(default=None, description="grouped scene id, null before grouping")
    people: int = Field(ge=0, le=100, description="number of people detected")
    objects: list[str] = Field(default_factory=list, description="salient objects/tags")
    location: Optional[str] = Field(default=None, description="inferred location/setting")
    action: Optional[str] = Field(default=None, description="main action in frame")
    text: Optional[str] = Field(default=None, description="visible OCR/text in frame")
    visual_description: str = Field(min_length=1, description="dense 1-2 sentence visual description")
    confidence: float = Field(ge=0.0, le=1.0, description="VLM confidence 0..1")

    def is_low_confidence(self) -> bool:
        return self.confidence < 0.5


class VisualScene(BaseModel):
    """Temporal grouping of nearby observations into a scene/action segment (requirement 6)."""

    model_config = ConfigDict(extra="forbid")

    scene_id: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    dominant_action: Optional[str] = None
    dominant_location: Optional[str] = None
    people_range: Optional[str] = None  # e.g. "1-2" or "2"
    observations: list[VisualObservation] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    evidence_note: Optional[str] = None  # grounding note for narrative


class FrameSample(BaseModel):
    """One sampled frame reference — input to VLM.

    video_ref is the source MinIO ref; timestamp is frame center.
    frame_ref is the presigned URL or base64 placeholder for mock.
    """

    model_config = ConfigDict(extra="forbid")

    timestamp: int = Field(ge=0)
    frame_ref: str = Field(description="presigned URL or storage ref for extracted frame image")
    scene_change_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    is_scene_boundary: bool = False


# ── VLM provider contract (requirement 3) ─────────────────────────────

# Wire protocol stays one of ProviderProtocol; capability for VLM = IMAGE|VIDEO|VISION
# Python accepts TEXT as well for backward compatibility (many vision models are TEXT).
VlmCapability = Literal["TEXT", "IMAGE", "VIDEO", "VISION"]


# ── Sampling strategy (requirement 1) ──────────────────────────────────

class VisualSamplingConfig(BaseModel):
    """Configurable frame sampling policy (requirement 1 + 4).

    * interval_ms      — uniform interval when not scene-aware
    * scene_aware      — when true, prefer scene-change boundaries
    * scene_threshold  — ffprobe scene score threshold (0..1) when scene_aware
    * max_frames       — hard cap; budget check fails if requested > cap
    * cost_per_image_tokens — estimated tokens per image for cost governance
    * prompt_version   — cache version bump string
    """

    model_config = ConfigDict(extra="forbid")

    interval_ms: int = Field(default=3000, ge=500, le=30000, description="uniform sampling interval ms")
    scene_aware: bool = Field(default=True, description="prefer scene boundaries when possible")
    scene_threshold: float = Field(default=0.3, ge=0.05, le=0.9)
    max_frames: int = Field(default=12, ge=1, le=30, description="hard cap on frames per video")
    cost_per_image_tokens: int = Field(default=800, ge=50, le=10000)
    prompt_version: str = Field(default="v1", description="prompt template version for cache invalidation")
    # budget governance
    max_total_image_tokens: int = Field(default=12000, ge=500, le=100000)
    max_budget_usd: Optional[float] = Field(default=None, ge=0.0)


# ── Cost governance (requirement 4) ────────────────────────────────────

class VisualCostEstimate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frames: int
    estimated_image_tokens: int
    estimated_total_tokens: int
    estimated_cost_usd: Optional[float] = None
    within_budget: bool = True
    reason: Optional[str] = None
    actual_cost_usd: Optional[float] = None


# ── Cache (requirement 5) ──────────────────────────────────────────────

class VisualCacheKey(BaseModel):
    model_config = ConfigDict(extra="forbid")

    video_hash: str
    timestamp: int
    model: str
    prompt_version: str

    def cache_key(self) -> str:
        import hashlib

        raw = f"{self.video_hash}:{self.timestamp}:{self.model}:{self.prompt_version}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ── Multimodal context (requirement 7) ─────────────────────────────────

class MultimodalContextModel(BaseModel):
    """Merge result: transcript + visual observations + scene boundaries (requirement 7).

    ``timeline`` is internal interleaved view for the narrative writer
    (speech/visual/scene sorted by timestamp with hedge flags) — kept for
    prompt injection convenience but also wire-compatible (Java ignores unknown).
    """

    model_config = ConfigDict(extra="forbid")

    transcript_segments: list[dict] = Field(default_factory=list)
    visual_observations: list[VisualObservation] = Field(default_factory=list)
    visual_scenes: list[VisualScene] = Field(default_factory=list)
    scene_boundaries_ms: list[int] = Field(default_factory=list)
    duration_ms: int = Field(ge=0, default=0)
    multimodal_summary: Optional[str] = None
    # internal timeline for prompt injection — optional on wire (Java ignores unknown if absent)
    timeline: Optional[list[dict]] = Field(default=None, description="interleaved speech/visual/scene timeline with hedge flags")


# ── Wire: Visual Understand request/response ───────────────────────────

class VisualUnderstandRequest(BaseModel):
    """Spring → FastAPI wire for VLM visual understanding.

    video_ref/video_url = source video location (presigned MinIO URL)
    sampling_config = how to sample frames
    transcript = optional transcript for multimodal context (may be sparse)
    provider = VLM provider (CEP abstraction, not hard-coded)
    video_duration_ms = real source duration (additive, nullable — fallback 120s when None)
    """

    model_config = ConfigDict(extra="forbid")

    correlation_id: str
    media_job_id: str
    video_ref: str
    video_url: str
    sampling_config: VisualSamplingConfig = Field(default_factory=VisualSamplingConfig)
    transcript: list[dict] = Field(default_factory=list)  # {text,start_ms,end_ms}
    provider: ProviderPayload
    # optional override for deterministic testing / frame list passthrough
    frame_samples: Optional[list[FrameSample]] = None
    # C1: real video duration ms — additive nullable, fallback to 120000 only when unavailable
    video_duration_ms: Optional[int] = Field(default=None, ge=0)


class VisualUnderstandResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    correlation_id: str
    status: Literal["COMPLETED", "FAILED"]
    observations: list[VisualObservation] = Field(default_factory=list)
    scenes: list[VisualScene] = Field(default_factory=list)
    cost: Optional[VisualCostEstimate] = None
    multimodal_context: Optional[MultimodalContextModel] = None
    frame_samples: list[FrameSample] = Field(default_factory=list)
    cache_hit: bool = False
    error: Optional[str] = None
    error_detail: Optional[ProviderErrorDetail] = None
    usage: Optional[dict] = None
    provider_request_ids: list[str] = Field(default_factory=list)
