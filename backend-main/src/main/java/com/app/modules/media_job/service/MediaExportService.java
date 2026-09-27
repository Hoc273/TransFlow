package com.app.modules.media_job.service;

import com.app.modules.media_job.dto.MediaExportResponse;

import java.util.UUID;

/**
 * Publishes a finished job's result (API_Contract.md §5 export). Separate from {@link MediaJobService}
 * because it needs the qa module's quality gate, and qa already depends on {@link MediaJobService}.
 */
public interface MediaExportService {

    /** {@code format}: VIDEO | SRT | VTT | SUBTITLE (alias of SRT), case-insensitive. */
    MediaExportResponse export(UUID workspaceId, UUID userId, UUID jobId, String format);

    /**
     * Storage ref ({@code "<bucket>/<key>"}) of the job's rendered video after the publish checks of {@code export}:
     * job COMPLETED (else STAGE_NOT_READY), no unresolved publish-blocking QA issue (else QA_BLOCKED),
     * RENDER output present (else STAGE_NOT_READY).
     */
    String renderOutputRef(UUID workspaceId, UUID userId, UUID jobId);

    /** The publish quality gate alone: an unresolved BLOCK_PUBLISH QA issue -> QA_BLOCKED (403). */
    void requirePublishAllowed(UUID workspaceId, UUID userId, UUID jobId);
}
