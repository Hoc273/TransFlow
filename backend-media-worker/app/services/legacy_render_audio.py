"""Compatibility-only audio builders for pre-CT9 render jobs.

New CT9 jobs must provide MIXED_AUDIO. These builders remain only for
historical AUDIO_MIX=SKIPPED jobs during the strangler migration.
"""

from __future__ import annotations

from typing import List

from app.services.ffmpeg import CutRange, SegmentAudio, build_dubbed_audio, build_original_audio


def resolve_legacy_audio(
    audio_source: str,
    audio_mode: str | None,
    segment_audios: List[SegmentAudio] | None,
    source_path: str,
    cut_ranges: List[CutRange],
    temp_dir: str,
) -> tuple[str, list[dict]]:
    """Build only the explicitly selected legacy audio representation."""
    if audio_source == "LEGACY_DUBBED":
        if audio_mode != "DUBBED" or not segment_audios:
            raise ValueError("LEGACY_DUBBED requires DUBBED mode and segment_audios")
        return build_dubbed_audio(source_path, cut_ranges, segment_audios, temp_dir)
    if audio_source == "LEGACY_ORIGINAL":
        if audio_mode != "ORIGINAL" or segment_audios:
            raise ValueError("LEGACY_ORIGINAL input is inconsistent")
        return build_original_audio(source_path, cut_ranges, temp_dir), []
    raise ValueError(f"Unsupported legacy audio source: {audio_source}")
