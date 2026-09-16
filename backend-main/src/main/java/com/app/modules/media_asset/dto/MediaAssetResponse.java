package com.app.modules.media_asset.dto;

import com.app.modules.media_asset.entity.MediaAsset;

import java.time.Instant;
import java.util.UUID;

public record MediaAssetResponse(
        UUID id,
        UUID projectId,
        UUID parentAssetId,
        String assetType,
        String fileName,
        String mimeType,
        long fileSizeBytes,
        Long durationMs,
        String processingStatus,
        Instant createdAt
) {
    public static MediaAssetResponse from(MediaAsset asset) {
        return new MediaAssetResponse(
                asset.getId(),
                asset.getProjectId(),
                asset.getParentAssetId(),
                asset.getAssetType().name(),
                asset.getFileName(),
                asset.getMimeType(),
                asset.getFileSizeBytes(),
                asset.getDurationMs(),
                asset.getProcessingStatus().name(),
                asset.getCreatedAt()
        );
    }
}
