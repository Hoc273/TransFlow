package com.app.modules.media_job.service;

import com.app.modules.media_job.dto.BulkDownloadResponse;

import java.util.List;
import java.util.UUID;

/** Zips the rendered videos of a user-selected set of finished jobs of one project (API_Contract.md §5). */
public interface MediaBulkDownloadService {

    /**
     * Jobs that are not in the project, not COMPLETED or QA-blocked go to {@code skipped}; when none is left the call
     * fails with QA_BLOCKED (some were QA-blocked) or STAGE_NOT_READY. More than the configured maximum distinct ids
     * fails with DOWNLOAD_SELECTION_TOO_LARGE.
     */
    BulkDownloadResponse download(UUID workspaceId, UUID userId, UUID projectId, List<UUID> jobIds);
}
