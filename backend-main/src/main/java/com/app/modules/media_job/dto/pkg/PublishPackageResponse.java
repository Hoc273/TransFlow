package com.app.modules.media_job.dto.pkg;

import java.util.List;
import java.util.UUID;

/** {@code GET/PUT .../publish-package}: GENERIC draft (no social auto-post); empty draft when nothing saved. */
public record PublishPackageResponse(
        String profile,
        String title,
        String description,
        String language,
        List<String> tags,
        String thumbnailRef,
        UUID sourceJobId,
        String status) {
}
