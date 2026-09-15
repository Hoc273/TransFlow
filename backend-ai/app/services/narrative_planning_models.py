from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


BeatType = Literal[
    "HOOK",
    "BODY",
    "PAYOFF",
    "CTA",
    "CONTEXT",
    "RISING_ACTION",
    "CLIMAX",
    "TURNING_POINT",
    "FALLING_ACTION",
    "RESOLUTION",
    "THEME",
]
_BEAT_TYPES = set(BeatType.__args__)


def normalize_beat_type(value: object) -> object:
    if value is None or not isinstance(value, str):
        return value
    normalized = re.sub(r"[^A-Z0-9]+", "_", value.strip().upper()).strip("_")
    if not normalized:
        return None
    if normalized.startswith("CLIMAX"):
        return "CLIMAX"
    return normalized if normalized in _BEAT_TYPES else None


NormalizedBeatType = Annotated[BeatType | None, BeforeValidator(normalize_beat_type)]

VisualStrategy = Literal[
    "SOURCE_CUT",
    "SOURCE_SPEED",
    "GENERATED",
    "RETRIEVED",
    "BLEND",
]
_VISUAL_STRATEGIES = set(VisualStrategy.__args__)


def normalize_visual_strategy(value: object) -> object:
    if value is None or not isinstance(value, str):
        return value
    normalized = re.sub(r"[^A-Z0-9]+", "_", value.strip().upper()).strip("_")
    if not normalized:
        return None
    return normalized if normalized in _VISUAL_STRATEGIES else None


NormalizedVisualStrategy = Annotated[VisualStrategy | None, BeforeValidator(normalize_visual_strategy)]


class _InternalModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TranscriptBlock(_InternalModel):
    block_id: str
    start_ms: int
    end_ms: int
    duration_ms: int
    text_preview: str
    ordered_index: int
    full_text: str
    # Timed constituent segments (populated by _build_transcript_blocks).
    # Lets post-allocation pacing split one oversized block at transcript
    # silences without losing text. Absent ([]) for legacy/test payloads.
    segments: list["BlockSegment"] = Field(default_factory=list)


class BlockSegment(_InternalModel):
    text: str
    start_ms: int
    end_ms: int


class SemanticSection(_InternalModel):
    section_id: str
    title: str | None = None
    goal: str
    preferred_blocks: list[str] = Field(default_factory=list)
    beat_hint: NormalizedBeatType = None
    # Runtime preserves at least one block for this explicitly essential section when budget permits.
    # beat_hint is descriptive arc role only; it does not imply essential=True.
    essential: bool = False


class BlockRanking(_InternalModel):
    block_id: str
    importance: float = Field(ge=0.0, le=1.0)
    section_id: str
    reason: str | None = None


class SemanticPlan(_InternalModel):
    sections: list[SemanticSection]
    block_rankings: list[BlockRanking]
    title: str | None = None
    reasoning_note: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)


class AllocatedSection(_InternalModel):
    section_id: str
    title: str | None = None
    goal: str
    beat_hint: str | None = None
    blocks: list[TranscriptBlock]


class AllocationResult(_InternalModel):
    sections: list[AllocatedSection]
    selected_blocks: list[TranscriptBlock]
    coverage_ms: int
    min_duration_ms: int
    max_duration_ms: int
    is_fallback: bool = False


class WrittenSection(_InternalModel):
    section_id: str
    heading: str | None = None
    script_source_lang: str
    beat_type: NormalizedBeatType = None
    notes: str | None = None
    # TASK 6 visual beat enrichment — optional but validated when present
    visual_description: str | None = None
    visual_strategy: NormalizedVisualStrategy = None
    importance: float | None = Field(default=None, ge=0.0, le=1.0)
    generate_terms: list[str] = Field(default_factory=list)


class NarrativeDraft(_InternalModel):
    sections: list[WrittenSection]
    title: str | None = None
    global_reasoning_note: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)
