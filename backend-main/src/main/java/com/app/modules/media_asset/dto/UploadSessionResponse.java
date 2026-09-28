package com.app.modules.media_asset.dto;

import com.app.modules.media_asset.service.MediaUploadSessionService;

import java.time.Instant;
import java.util.UUID;

public record UploadSessionResponse(
        UUID uploadId,
        long chunkSizeBytes,
        int totalChunks,
        int receivedChunks,
        /** Session is dropped when idle past this instant; each chunk pushes it back. */
        Instant expiresAt
) {
    public static UploadSessionResponse from(MediaUploadSessionService.UploadSession s) {
        return new UploadSessionResponse(s.uploadId(), s.chunkSizeBytes(), s.totalChunks(),
                s.receivedChunks(), s.expiresAt());
    }
}
