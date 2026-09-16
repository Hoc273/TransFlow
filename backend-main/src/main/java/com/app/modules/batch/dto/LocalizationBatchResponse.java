package com.app.modules.batch.dto;

import com.app.modules.batch.entity.LocalizationBatch;
import com.app.modules.media_job.dto.MediaJobResponse;
import com.fasterxml.jackson.annotation.JsonRawValue;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record LocalizationBatchResponse(
        UUID id,
        UUID workspaceId,
        UUID projectId,
        String name,
        List<UUID> sourceAssetIds,
        String targetLang,
        @JsonRawValue String sharedConfig,
        String status,
        UUID createdBy,
        Instant createdAt,
        List<MediaJobResponse> jobs
) {
    public static LocalizationBatchResponse from(LocalizationBatch b, List<MediaJobResponse> jobs) {
        return new LocalizationBatchResponse(b.getId(), b.getWorkspaceId(), b.getProjectId(), b.getName(),
                b.getSourceAssetIds(), b.getTargetLang(), b.getSharedConfig(), b.getStatus().name(),
                b.getCreatedBy(), b.getCreatedAt(), jobs);
    }
}
