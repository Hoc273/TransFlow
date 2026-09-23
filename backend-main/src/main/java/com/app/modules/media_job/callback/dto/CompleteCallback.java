package com.app.modules.media_job.callback.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.UUID;

/** {@code POST /internal/media/{stage}/complete} body (API_Contract.md §14). */
@JsonIgnoreProperties(ignoreUnknown = true)
public record CompleteCallback(UUID jobId, UUID stageId, String dedupeKey, JsonNode outputRef,
                                boolean success, String errorMessage, String errorCode) {

    public CompleteCallback(UUID jobId, UUID stageId, String dedupeKey, JsonNode outputRef,
                             boolean success, String errorMessage) {
        this(jobId, stageId, dedupeKey, outputRef, success, errorMessage, null);
    }
}
