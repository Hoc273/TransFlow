package com.app.modules.media_job.callback.dto;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.UUID;

/** {@code POST /internal/media/{stage}/complete} body (API_Contract.md §14). */
public record CompleteCallback(UUID jobId, UUID stageId, String dedupeKey, JsonNode outputRef,
                                boolean success, String errorMessage) {
}
