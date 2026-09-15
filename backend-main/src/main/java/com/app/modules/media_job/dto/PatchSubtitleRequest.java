package com.app.modules.media_job.dto;

/** {@code PATCH .../subtitles/{segmentId}} body (API_Contract.md §5) — all fields optional. */
public record PatchSubtitleRequest(String targetText, Long startMs, Long endMs) {
}
