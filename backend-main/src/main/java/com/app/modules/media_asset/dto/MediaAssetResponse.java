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
        Instant createdAt,
        /** When the retention sweep deletes the stored file (null when unknown). */
        Instant expiresAt,
        /** Set once the file was deleted; the asset can no longer start or rerun jobs. */
        Instant purgedAt
) {
    public static MediaAssetResponse from(MediaAsset asset) {
        return from(asset, null);
    }

    public static MediaAssetResponse from(MediaAsset asset, java.time.Duration retention) {
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
                asset.getCreatedAt(),
                retention == null || asset.getCreatedAt() == null ? null : asset.getCreatedAt().plus(retention),
                asset.getPurgedAt()
        );
    }
}
