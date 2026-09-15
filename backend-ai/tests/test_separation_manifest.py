from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.source_separation import SeparationManifest


def valid_manifest() -> dict:
    stems = [
        {
            "role": role,
            "objectRef": f"transflow-media/separation/run-1/{role.lower()}",
            "durationMs": 1000,
            "mimeType": "audio/wav",
            "codec": "pcm_s16le",
            "channels": 2,
            "sampleRateHz": 44100,
            "fileSizeBytes": 8,
            "checksumSha256": "a" * 64,
        }
        for role in ("VOCAL", "MUSIC")
    ]
    return {
        "manifestVersion": 1,
        "runId": "run-1",
        "engine": {
            "engineId": "local_demucs",
            "engineVersion": "demucs",
            "modelId": "htdemucs",
        },
        "profile": {
            "id": "VOCAL_MUSIC",
            "requiredRoles": ["VOCAL", "MUSIC"],
            "optionalRoles": ["EFFECTS", "OTHER", "CUSTOM"],
        },
        "stems": stems,
        "warnings": [],
        "outputSummary": {"roles": ["VOCAL", "MUSIC"], "stemCount": 2},
        "statistics": {
            "executionTimeMs": 25,
            "inputDurationMs": 1000,
            "producedStemCount": 2,
            "quality": {
                "signalQuality": None,
                "clippingDetected": None,
                "peakDb": None,
                "rmsDb": None,
                "confidence": None,
            },
            "perStemQuality": [],
        },
    }


def test_manifest_accepts_canonical_v1_and_serializes_aliases() -> None:
    manifest = SeparationManifest.model_validate(valid_manifest())
    payload = manifest.model_dump(by_alias=True, mode="json")
    assert payload["manifestVersion"] == 1
    assert payload["profile"]["requiredRoles"] == ["VOCAL", "MUSIC"]
    assert "filename" not in str(payload).lower()


@pytest.mark.parametrize("mutation", ["version", "missing_role", "duplicate_role", "summary"])
def test_manifest_rejects_internal_contract_violation(mutation: str) -> None:
    payload = valid_manifest()
    if mutation == "version":
        payload["manifestVersion"] = 2
    elif mutation == "missing_role":
        payload["stems"] = payload["stems"][:1]
        payload["outputSummary"] = {"roles": ["VOCAL"], "stemCount": 1}
        payload["statistics"]["producedStemCount"] = 1
    elif mutation == "duplicate_role":
        payload["stems"][1]["role"] = "VOCAL"
        payload["outputSummary"]["roles"] = ["VOCAL", "VOCAL"]
    else:
        payload["outputSummary"]["stemCount"] = 99
    with pytest.raises(ValidationError):
        SeparationManifest.model_validate(payload)


def test_manifest_forbids_engine_specific_fields() -> None:
    payload = valid_manifest()
    payload["stems"][0]["filename"] = "vocals.wav"
    with pytest.raises(ValidationError, match="filename"):
        SeparationManifest.model_validate(payload)


def test_manifest_rejects_custom_stem_without_logical_key() -> None:
    payload = valid_manifest()
    payload["stems"].append(
        {
            "role": "CUSTOM",
            "objectRef": "transflow-media/separation/run-1/custom",
            "durationMs": 1000,
            "mimeType": "audio/wav",
            "codec": "pcm_s16le",
            "channels": 2,
            "sampleRateHz": 44100,
            "fileSizeBytes": 8,
            "checksumSha256": "a" * 64,
        }
    )
    payload["outputSummary"] = {"roles": ["VOCAL", "MUSIC", "CUSTOM"], "stemCount": 3}
    payload["statistics"]["producedStemCount"] = 3
    with pytest.raises(ValidationError, match="customRoleKey"):
        SeparationManifest.model_validate(payload)
