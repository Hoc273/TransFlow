package com.app.modules.media_job.pipeline.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** Request body accepted by backend-media-worker's asynchronous extract endpoint. */
public record ExtractAudioRequest(
        @JsonProperty("correlation_id") String correlationId,
        @JsonProperty("media_job_id") String mediaJobId,
        @JsonProperty("stage_id") String stageId,
        @JsonProperty("source_video_ref") String sourceVideoRef
) {
}
