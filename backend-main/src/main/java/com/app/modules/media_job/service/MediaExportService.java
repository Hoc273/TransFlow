package com.app.modules.media_job.service;

import com.app.modules.media_job.dto.MediaExportResponse;

import java.util.UUID;

/**
 * Publishes a finished job's result (API_Contract.md §5 export). Separate from {@link MediaJobService}
 * because it needs the qa module's quality gate, and qa already depends on {@link MediaJobService}.
 */
public interface MediaExportService {

    /** {@code format}: VIDEO | SUBTITLE (case-insensitive). */
    MediaExportResponse export(UUID workspaceId, UUID userId, UUID jobId, String format);
}
