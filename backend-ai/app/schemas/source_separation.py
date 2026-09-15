"""Engine-neutral source-separation contract (ADR-CT7, SeparationManifest V1)."""
from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class AudioRole(StrEnum):
    VOCAL = "VOCAL"
    MUSIC = "MUSIC"
    EFFECTS = "EFFECTS"
    OTHER = "OTHER"
    CUSTOM = "CUSTOM"


class SeparationProfileId(StrEnum):
    VOCAL_MUSIC = "VOCAL_MUSIC"


_PROFILE_ROLE_CONTRACTS = {
    SeparationProfileId.VOCAL_MUSIC: (
        frozenset({AudioRole.VOCAL, AudioRole.MUSIC}),
        frozenset({AudioRole.EFFECTS, AudioRole.OTHER, AudioRole.CUSTOM}),
    ),
}


def profile_roles(profile: SeparationProfileId) -> tuple[frozenset[AudioRole], frozenset[AudioRole]]:
    """Return the fixed logical role contract for a negotiated profile."""
    return _PROFILE_ROLE_CONTRACTS[profile]


class EngineIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    engine_id: str = Field(alias="engineId", min_length=1)
    engine_version: str = Field(alias="engineVersion", min_length=1)
    model_id: str = Field(alias="modelId", min_length=1)


class NegotiatedProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: SeparationProfileId
    required_roles: list[AudioRole] = Field(alias="requiredRoles", min_length=1)
    optional_roles: list[AudioRole] = Field(alias="optionalRoles", default_factory=list)

    @model_validator(mode="after")
    def validate_roles(self) -> "NegotiatedProfile":
        required = list(self.required_roles)
        optional = list(self.optional_roles)
        if len(set(required)) != len(required):
            raise ValueError("requiredRoles must not contain duplicates")
        if len(set(optional)) != len(optional):
            raise ValueError("optionalRoles must not contain duplicates")
        if set(required) & set(optional):
            raise ValueError("requiredRoles and optionalRoles must be disjoint")
        expected_required, expected_optional = profile_roles(self.id)
        if set(required) != expected_required or set(optional) != expected_optional:
            raise ValueError("profile roles do not match the negotiated profile contract")
        return self


class Stem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: AudioRole
    object_ref: str = Field(alias="objectRef", min_length=1)
    duration_ms: Annotated[int, Field(alias="durationMs", ge=1)]
    mime_type: str = Field(alias="mimeType", min_length=1)
    codec: str = Field(min_length=1)
    channels: Annotated[int, Field(ge=1)]
    sample_rate_hz: Annotated[int, Field(alias="sampleRateHz", ge=1)]
    file_size_bytes: Annotated[int, Field(alias="fileSizeBytes", gt=0)]
    checksum_sha256: str = Field(alias="checksumSha256", pattern=r"^[0-9a-fA-F]{64}$")
    custom_role_key: str | None = Field(default=None, alias="customRoleKey", min_length=1)

    @field_validator("object_ref")
    @classmethod
    def object_ref_must_be_opaque(cls, value: str) -> str:
        if not value.strip() or "\\" in value or ".." in value or value.startswith(("/", "file:")):
            raise ValueError("objectRef must be an opaque storage reference")
        return value

    @model_validator(mode="after")
    def custom_role_requires_key(self) -> "Stem":
        if self.role is AudioRole.CUSTOM and self.custom_role_key is None:
            raise ValueError("CUSTOM stems require customRoleKey")
        if self.role is not AudioRole.CUSTOM and self.custom_role_key is not None:
            raise ValueError("customRoleKey is only valid for CUSTOM stems")
        return self


class SeparationWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    role: AudioRole | None = None


class QualityStatistics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signal_quality: float | None = Field(default=None, alias="signalQuality")
    clipping_detected: bool | None = Field(default=None, alias="clippingDetected")
    peak_db: float | None = Field(default=None, alias="peakDb")
    rms_db: float | None = Field(default=None, alias="rmsDb")
    confidence: float | None = None


class PerStemQuality(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: AudioRole
    signal_quality: float | None = Field(default=None, alias="signalQuality")
    clipping_detected: bool | None = Field(default=None, alias="clippingDetected")
    peak_db: float | None = Field(default=None, alias="peakDb")
    rms_db: float | None = Field(default=None, alias="rmsDb")
    confidence: float | None = None


class SeparationStatistics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    execution_time_ms: Annotated[int, Field(alias="executionTimeMs", ge=0)]
    input_duration_ms: Annotated[int, Field(alias="inputDurationMs", ge=0)]
    produced_stem_count: Annotated[int, Field(alias="producedStemCount", ge=0)]
    quality: QualityStatistics = Field(default_factory=QualityStatistics)
    per_stem_quality: list[PerStemQuality] = Field(alias="perStemQuality", default_factory=list)


class OutputSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roles: list[AudioRole]
    stem_count: Annotated[int, Field(alias="stemCount", ge=0)]

    @model_validator(mode="after")
    def agree_with_roles(self) -> "OutputSummary":
        if len(set(self.roles)) != len(self.roles):
            raise ValueError("outputSummary.roles must not contain duplicates")
        if self.stem_count != len(self.roles):
            raise ValueError("outputSummary.stemCount must equal roles length")
        return self


class SeparationManifest(BaseModel):
    """Canonical V1 response; provider filenames never cross this boundary."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    manifest_version: Annotated[int, Field(alias="manifestVersion", strict=True)]
    run_id: str = Field(alias="runId", min_length=1)
    engine: EngineIdentity
    negotiated_profile: NegotiatedProfile = Field(alias="profile")
    stems: list[Stem] = Field(min_length=1)
    warnings: list[SeparationWarning] = Field(default_factory=list)
    output_summary: OutputSummary = Field(alias="outputSummary")
    statistics: SeparationStatistics

    @model_validator(mode="after")
    def validate_manifest(self) -> "SeparationManifest":
        if self.manifest_version != 1:
            raise ValueError("manifestVersion must be 1")
        roles = [stem.role for stem in self.stems]
        if len(set(roles)) != len(roles):
            raise ValueError("stems must contain each role at most once")
        missing = set(self.negotiated_profile.required_roles) - set(roles)
        if missing:
            raise ValueError(f"missing required stem roles: {sorted(role.value for role in missing)}")
        if set(roles) - set(self.negotiated_profile.required_roles) - set(self.negotiated_profile.optional_roles):
            raise ValueError("stems contain roles outside the negotiated profile")
        if self.output_summary.roles != roles or self.output_summary.stem_count != len(self.stems):
            raise ValueError("outputSummary must agree with stems")
        if self.statistics.produced_stem_count != len(self.stems):
            raise ValueError("statistics.producedStemCount must equal stem count")
        quality_roles = [quality.role for quality in self.statistics.per_stem_quality]
        if len(set(quality_roles)) != len(quality_roles) or set(quality_roles) - set(roles):
            raise ValueError("perStemQuality roles must be unique produced stem roles")
        return self


class SourceSeparationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    run_id: str = Field(alias="runId", min_length=1, max_length=128)
    source_audio_ref: str = Field(alias="sourceAudioRef", min_length=1)
    profile: SeparationProfileId

    @field_validator("run_id")
    @classmethod
    def run_id_must_be_safe_for_object_key(cls, value: str) -> str:
        if ".." in value or "/" in value or "\\" in value:
            raise ValueError("runId must be an opaque identifier")
        return value
