package com.app.modules.batch.service;

import com.app.modules.batch.dto.CreateBatchRequest;
import com.app.modules.batch.entity.LocalizationBatch;
import com.app.modules.media_job.entity.MediaJob;

import java.util.List;
import java.util.UUID;

/**
 * Video Batch Localization (API_Contract.md §6, Database_Design.md §6.1,
 * Backend_Java_TaskSplit_MemberB.md §2.4).
 */
public interface BatchService {

    LocalizationBatch createBatch(UUID workspaceId, UUID userId, UUID projectId, CreateBatchRequest request);

    List<LocalizationBatch> listBatches(UUID workspaceId, UUID userId, UUID projectId);

    LocalizationBatch getBatch(UUID workspaceId, UUID userId, UUID batchId);

    List<MediaJob> getChildJobs(UUID batchId);

    LocalizationBatch cancelBatch(UUID workspaceId, UUID userId, UUID batchId);

    /** Reruns a single FAILED child job from its failed stage; does not touch sibling jobs. */
    MediaJob retryChildJob(UUID workspaceId, UUID userId, UUID batchId, UUID jobId);
}
