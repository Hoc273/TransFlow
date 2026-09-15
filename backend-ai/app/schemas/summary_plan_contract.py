"""M17.2-A — SummaryPlan deterministic contract.

Represents the deterministic intelligence plan for multimodal video summarization.
Bridges MultimodalContext -> SummaryPlan -> Executable Scene Contract.
Renderer/Composition takes this plan and does not call any LLM.
"""
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class SceneImportanceScore(BaseModel):
    """Scoring component for scene selection (M17.2-B)."""

    model_config = ConfigDict(extra="forbid")

    action_intensity: float = Field(ge=0.0, le=1.0, description="Intensity of movement/action detected in scene")
    visual_novelty: float = Field(ge=0.0, le=1.0, description="Visual uniqueness relative to neighboring scenes")
    narrative_relevance: float = Field(ge=0.0, le=1.0, description="Key turning point or hook/climax relevance")
    transcript_relevance: float = Field(ge=0.0, le=1.0, description="Relevance of speech/dialogue in this time window")
    composite_score: float = Field(ge=0.0, le=1.0, description="Weighted composite importance")


class SummaryScenePlan(BaseModel):
    """One planned scene in the summary timeline (M17.2-A / M17.3-A)."""

    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(description="Unique scene identifier e.g. scene-001")
    source_start_ms: int = Field(ge=0, description="Start timestamp on source video timeline")
    source_end_ms: int = Field(ge=0, description="End timestamp on source video timeline")
    summary_start_ms: int = Field(ge=0, description="Start timestamp on summary video timeline")
    summary_end_ms: int = Field(ge=0, description="End timestamp on summary video timeline")
    narration_text: str = Field(description="Grounded narration for this scene")
    visual_strategy: Literal["SOURCE_CLIP", "GENERATED_IMAGE", "MIXED"] = Field(
        default="SOURCE_CLIP", description="Visual strategy for rendering this scene"
    )
    visual_evidence_refs: list[str] = Field(
        default_factory=list, description="IDs or timestamps of visual observations supporting this scene"
    )
    transition: str = Field(default="cut", description="Visual transition e.g. cut, fade, dissolve")
    audio_mode: Literal["VOICEOVER", "ORIGINAL_AUDIO", "DUCKED_MIX"] = Field(
        default="VOICEOVER", description="Audio execution strategy"
    )
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence of the scene interpretation")
    importance: float = Field(ge=0.0, le=1.0, description="Overall ranking score")
    unsupported_claims: list[str] = Field(
        default_factory=list, description="Any unverified claims detected during grounding check"
    )


class SummaryPlan(BaseModel):
    """Deterministic contract for the entire video summary (M17.2-A)."""

    model_config = ConfigDict(extra="forbid")

    plan_id: str = Field(description="Unique summary plan ID")
    target_duration_ms: int = Field(gt=0, description="Requested target summary duration in ms")
    total_summary_duration_ms: int = Field(gt=0, description="Calculated duration of all planned scenes")
    summary_objective: str = Field(description="Objective of the summary (e.g. action highlights, narrative)")
    scenes: list[SummaryScenePlan] = Field(min_length=1, description="Ordered list of summary scenes")
    overall_confidence: float = Field(ge=0.0, le=1.0, description="Aggregated confidence across scenes")
    visual_action_ratio: float = Field(
        ge=0.0, le=1.0, description="Proportion of summary driven by visual action vs speech"
    )
    unsupported_claims: list[str] = Field(
        default_factory=list, description="Aggregated unsupported claims pruned or hedged"
    )
