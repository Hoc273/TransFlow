package com.app.modules.media_asset.service;

import com.app.modules.media_asset.entity.MediaAsset;

import java.io.InputStream;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Chunked (resumable) video upload (API_Contract.md §4). Chunks stay under the 100MB request cap
 * of a Cloudflare-proxied origin and the 10MB default body limit of the host nginx; they are
 * staged on the backend-main disk and turned into a SOURCE_VIDEO asset on {@link #complete}.
 * Staging is local to the instance: the deployment runs a single backend-main.
 */
public interface MediaUploadSessionService {

    UploadSession start(UUID workspaceId, UUID userId, UUID projectId,
                        String fileName, long fileSizeBytes, String contentType);

    /** Idempotent per index: re-sending a chunk overwrites the same byte range. */
    UploadSession putChunk(UUID workspaceId, UUID userId, UUID uploadId, int index,
                           long contentLength, InputStream body);

    /** Validates (ffprobe) and stores the video; repeating the call returns the same asset. */
    MediaAsset complete(UUID workspaceId, UUID userId, UUID uploadId, String name);

    /**
     * Current state of a session so an interrupted client (page reload, lost connection) can resume:
     * which chunks the server already holds, and whether {@link #complete} already produced an asset.
     */
    UploadSession status(UUID workspaceId, UUID userId, UUID uploadId);

    void abort(UUID workspaceId, UUID userId, UUID uploadId);

    record UploadSession(UUID uploadId, long chunkSizeBytes, int totalChunks,
                         int receivedChunks, List<Integer> receivedIndexes,
                         boolean completed, Instant expiresAt) {}
}
