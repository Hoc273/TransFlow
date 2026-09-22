package com.app.modules.batch.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.batch.dto.CreateBatchRequest;
import com.app.modules.batch.dto.SharedJobConfig;
import com.app.modules.batch.entity.LocalizationBatch;
import com.app.modules.batch.repository.LocalizationBatchRepository;
import com.app.modules.batch.service.BatchCreateRateLimiter;
import com.app.modules.batch.service.BatchService;
import com.app.modules.media_job.dto.CreateMediaJobRequest;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.workspace.service.WorkspaceAccessService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class BatchServiceImpl implements BatchService {

    private static final int MAX_BATCH_SIZE = 20;

    private final LocalizationBatchRepository localizationBatchRepository;
    private final WorkspaceAccessService access;
    private final MediaJobService mediaJobService;
    private final BatchCreateRateLimiter rateLimiter;
    private final ObjectMapper objectMapper;

    public BatchServiceImpl(LocalizationBatchRepository localizationBatchRepository,
                             WorkspaceAccessService access,
                             MediaJobService mediaJobService,
                             BatchCreateRateLimiter rateLimiter,
                             ObjectMapper objectMapper) {
        this.localizationBatchRepository = localizationBatchRepository;
        this.access = access;
        this.mediaJobService = mediaJobService;
        this.rateLimiter = rateLimiter;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public LocalizationBatch createBatch(UUID workspaceId, UUID userId, UUID projectId, CreateBatchRequest request) {
        access.requireProjectWriteAccess(workspaceId, userId, projectId);

        List<UUID> assetIds = request.sourceAssetIds();
        if (assetIds == null || assetIds.isEmpty() || assetIds.size() > MAX_BATCH_SIZE) {
            throw new AppException(ErrorCode.BATCH_SIZE_EXCEEDED);
        }
        if (rateLimiter.isRateLimited(userId)) {
            throw new AppException(ErrorCode.BATCH_RATE_LIMIT_EXCEEDED);
        }

        SharedJobConfig config = request.sharedConfig() != null
                ? request.sharedConfig()
                : new SharedJobConfig(null, null, null, null, null, null, null, null);

        LocalizationBatch batch = new LocalizationBatch();
        batch.setWorkspaceId(workspaceId);
        batch.setProjectId(projectId);
        batch.setName(request.name());
        batch.setSourceAssetIds(assetIds);
        batch.setTargetLang(request.targetLang());
        batch.setSharedConfig(toJson(config));
        batch.setStatus(LocalizationBatch.BatchStatus.PENDING);
        batch.setCreatedBy(userId);
        batch.setCreatedAt(Instant.now());
        batch = localizationBatchRepository.save(batch);

        for (UUID assetId : assetIds) {
            CreateMediaJobRequest jobRequest = new CreateMediaJobRequest(
                    projectId, assetId, MediaJob.RECIPE_LOCALIZATION_FULL, config.processingMode(),
                    request.targetLang(), null, config.subtitleMode(), config.outputAudioMode(),
                    config.sourceSeparationEnabled(), config.ttsProviderId(), config.ttsVoiceId(), null, config.workflowMode(),
                    config.presetId());
            mediaJobService.createBatchChildJob(workspaceId, userId, batch.getId(), jobRequest);
        }
        return batch;
    }

    @Override
    @Transactional(readOnly = true)
    public List<LocalizationBatch> listBatches(UUID workspaceId, UUID userId, UUID projectId) {
        access.requireProjectAccess(workspaceId, userId, projectId);
        return localizationBatchRepository.findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(workspaceId, projectId);
    }

    @Override
    @Transactional(readOnly = true)
    public LocalizationBatch getBatch(UUID workspaceId, UUID userId, UUID batchId) {
        LocalizationBatch batch = requireBatchInWorkspace(workspaceId, batchId);
        access.requireProjectAccess(workspaceId, userId, batch.getProjectId());
        return batch;
    }

    @Override
    @Transactional(readOnly = true)
    public List<MediaJob> getChildJobs(UUID batchId) {
        return mediaJobService.getJobsByBatch(batchId);
    }

    @Override
    @Transactional
    public LocalizationBatch cancelBatch(UUID workspaceId, UUID userId, UUID batchId) {
        LocalizationBatch batch = requireBatchInWorkspace(workspaceId, batchId);
        access.requireProjectWriteAccess(workspaceId, userId, batch.getProjectId());
        batch = localizationBatchRepository.findWithLockById(batchId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));

        for (MediaJob job : mediaJobService.getJobsByBatch(batchId)) {
            if (job.getStatus() == MediaJob.JobStatus.PENDING || job.getStatus() == MediaJob.JobStatus.PROCESSING) {
                mediaJobService.cancelJob(workspaceId, userId, job.getId());
            }
        }
        batch.setStatus(LocalizationBatch.BatchStatus.CANCELLED);
        return localizationBatchRepository.save(batch);
    }

    @Override
    @Transactional
    public MediaJob retryChildJob(UUID workspaceId, UUID userId, UUID batchId, UUID jobId) {
        LocalizationBatch batch = requireBatchInWorkspace(workspaceId, batchId);
        access.requireProjectWriteAccess(workspaceId, userId, batch.getProjectId());

        MediaJob job = mediaJobService.getJob(workspaceId, userId, jobId);
        if (job.getBatchId() == null || !job.getBatchId().equals(batchId)) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        if (job.getStatus() != MediaJob.JobStatus.FAILED) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        MediaJobStage.StageName failedStage = mediaJobService.getStages(jobId).stream()
                .filter(s -> s.getStatus() == MediaJobStage.StageStatus.FAILED)
                .map(MediaJobStage::getStageName)
                .findFirst()
                .orElseThrow(() -> new AppException(ErrorCode.VALIDATION_ERROR));

        MediaJob retried = mediaJobService.rerunFromStage(workspaceId, userId, jobId, failedStage);
        recomputeStatus(batchId);
        return retried;
    }

    // Arch §6/§12 — recomputed in the same transaction as the child-job update that triggered it,
    // under a batch row lock (SELECT ... FOR UPDATE invariant).
    @Override
    @Transactional
    public void recomputeStatus(UUID batchId) {
        LocalizationBatch batch = localizationBatchRepository.findWithLockById(batchId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        if (batch.getStatus() == LocalizationBatch.BatchStatus.CANCELLED) {
            return; // terminal, a deliberate user action — never overwritten by recompute
        }
        List<MediaJob> children = mediaJobService.getJobsByBatch(batchId);
        if (children.isEmpty()) {
            return;
        }
        boolean anyInFlight = children.stream()
                .anyMatch(j -> j.getStatus() == MediaJob.JobStatus.PENDING || j.getStatus() == MediaJob.JobStatus.PROCESSING);
        if (anyInFlight) {
            batch.setStatus(LocalizationBatch.BatchStatus.PROCESSING);
        } else {
            boolean allCompleted = children.stream().allMatch(j -> j.getStatus() == MediaJob.JobStatus.COMPLETED);
            boolean allFailed = children.stream().allMatch(j -> j.getStatus() == MediaJob.JobStatus.FAILED);
            batch.setStatus(allCompleted ? LocalizationBatch.BatchStatus.COMPLETED
                    : allFailed ? LocalizationBatch.BatchStatus.FAILED
                    : LocalizationBatch.BatchStatus.PARTIALLY_FAILED);
        }
        localizationBatchRepository.save(batch);
    }

    private LocalizationBatch requireBatchInWorkspace(UUID workspaceId, UUID batchId) {
        return localizationBatchRepository.findByIdAndWorkspaceId(batchId, workspaceId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
    }

    private String toJson(SharedJobConfig config) {
        try {
            return objectMapper.writeValueAsString(config);
        } catch (Exception e) {
            return "{}";
        }
    }
}
