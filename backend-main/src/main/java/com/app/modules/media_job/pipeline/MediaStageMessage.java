package com.app.modules.media_job.pipeline;

import java.util.UUID;

/** Minimal queue payload; media bytes and secrets never travel through RabbitMQ. */
public record MediaStageMessage(
        UUID jobId,
        UUID stageId,
        String stageName,
        UUID correlationId,
        short attemptCount
) {
    public MediaStageMessage {
        if (jobId == null || stageId == null || correlationId == null
                || stageName == null || stageName.isBlank()) {
            throw new IllegalArgumentException("Media stage message identifiers are required");
        }
    }
}
