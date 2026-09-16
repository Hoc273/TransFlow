package com.app.modules.media_job.dto;

import com.app.modules.media_job.entity.MediaJobStage;

import java.time.Instant;
import java.util.UUID;

public record MediaJobStageResponse(
        UUID id,
        String stageName,
        short stageOrder,
        String status,
        short progressPercent,
        String workerId,
        short attemptCount,
        Long executionTimeMs,
        String errorMessage,
        Instant startedAt,
        Instant completedAt
) {
    public static MediaJobStageResponse from(MediaJobStage s) {
        return new MediaJobStageResponse(
                s.getId(), s.getStageName().name(), s.getStageOrder(), s.getStatus().name(),
                s.getProgressPercent(), s.getWorkerId(), s.getAttemptCount(), s.getExecutionTimeMs(),
                s.getErrorMessage(), s.getStartedAt(), s.getCompletedAt());
    }
}
