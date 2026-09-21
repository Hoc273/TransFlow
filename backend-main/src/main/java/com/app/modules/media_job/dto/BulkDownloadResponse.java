package com.app.modules.media_job.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Zip of the selected finished videos; {@code skipped} lists selected jobs left out and why. */
public record BulkDownloadResponse(
        String downloadUrl,
        String fileName,
        Instant expiresAt,
        List<UUID> includedJobIds,
        List<Skipped> skipped) {

    /** {@code reason}: NOT_FOUND (unknown / other project) | NOT_COMPLETED | QA_BLOCKED. */
    public record Skipped(UUID jobId, String reason) {
    }
}
