"""Script-first video summarization contract.

The script endpoint is deliberately separate from the legacy extractive
``/media/summarize`` contract.  Spring persists these fields directly into
``summary_proposals`` and ``summary_proposal_segments``.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field

from app.schemas.contract import ProviderPayload, SttSegment, Usage


class ScriptSegment(BaseModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    script_excerpt: str = Field(min_length=1)
    source_sentence_refs: list[str] = Field(default_factory=list)
    reasoning_note: Optional[str] = None


class ScriptSummarizeRequest(BaseModel):
    correlation_id: str
    media_job_id: str
    transcript: list[SttSegment] = Field(default_factory=list)
    requested_duration_seconds: int = Field(gt=0)
    target_lang: str = Field(min_length=1)
    visual_context: Any = None
    provider: ProviderPayload
    # Voice speaking rate (characters/second of target text) calibrated by Spring
    # from measured TTS; sizes the narration so it fills the requested duration.
    narration_cps: Optional[float] = Field(default=None, gt=0)


class ScriptRefineRequest(BaseModel):
    correlation_id: str
    media_job_id: str
    previous_script: str = Field(min_length=1)
    feedback_text: str = Field(min_length=1)
    target_lang: str = Field(min_length=1)
    requested_duration_seconds: Optional[int] = Field(default=None, gt=0)
    transcript: list[SttSegment] = Field(default_factory=list)
    visual_context: Any = None
    provider: ProviderPayload
    # Voice speaking rate (characters/second of target text) calibrated by Spring
    # from measured TTS; sizes the narration so it fills the requested duration.
    narration_cps: Optional[float] = Field(default=None, gt=0)


class ScriptSummarizeResponse(BaseModel):
    correlation_id: str
    status: str
    script_content: Optional[str] = None
    script_language: Optional[str] = None
    segments: list[ScriptSegment] = Field(default_factory=list)
    reasoning_note: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)
    usage: Optional[Usage] = None
    error: Optional[str] = None
    error_detail: Optional[dict[str, Any]] = None
