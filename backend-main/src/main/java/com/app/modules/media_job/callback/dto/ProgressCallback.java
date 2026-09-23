package com.app.modules.media_job.callback.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.UUID;

/** {@code POST /internal/media/{stage}/progress} body (API_Contract.md §14). */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ProgressCallback(UUID jobId, UUID stageId, String dedupeKey, short progressPercent) {
}
