package com.app.modules.media_job.service;

import com.app.modules.media_job.dto.pkg.OutputPackageResponse;
import com.app.modules.media_job.dto.pkg.PublishPackageResponse;
import com.app.modules.media_job.dto.pkg.UpdatePublishPackageRequest;

import java.util.UUID;

/** Output package (preview) and publish-package draft of a finished job (API_Contract.md §5). */
public interface MediaPackageService {

    /** RENDER must be COMPLETED (else STAGE_NOT_READY). Not QA-gated: it is what the preview modal plays. */
    OutputPackageResponse outputPackage(UUID workspaceId, UUID userId, UUID jobId);

    PublishPackageResponse getPublishPackage(UUID workspaceId, UUID userId, UUID jobId);

    /** LEAD or owning MEMBER; an unresolved BLOCK_PUBLISH QA issue -> QA_BLOCKED. Partial update (null = keep). */
    PublishPackageResponse updatePublishPackage(UUID workspaceId, UUID userId, UUID jobId, UpdatePublishPackageRequest request);
}
