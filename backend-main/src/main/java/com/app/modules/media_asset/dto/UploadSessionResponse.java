package com.app.modules.media_asset.dto;

import com.app.modules.media_asset.service.MediaUploadSessionService;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record UploadSessionResponse(
        UUID uploadId,
        long chunkSizeBytes,
        int totalChunks,
        int receivedChunks,
        /** Sorted indexes of the chunks already stored: a resuming client sends only the others. */
        List<Integer> receivedIndexes,
        /** True once `complete` produced the asset; a resuming client only needs to call `complete` again. */
        boolean completed,
        /** Session is dropped when idle past this instant; each chunk pushes it back. */
        Instant expiresAt
) {
    public static UploadSessionResponse from(MediaUploadSessionService.UploadSession s) {
        return new UploadSessionResponse(s.uploadId(), s.chunkSizeBytes(), s.totalChunks(),
                s.receivedChunks(), s.receivedIndexes(), s.completed(), s.expiresAt());
    }
}
