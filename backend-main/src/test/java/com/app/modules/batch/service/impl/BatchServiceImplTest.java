package com.app.modules.batch.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.batch.dto.CreateBatchRequest;
import com.app.modules.batch.dto.SharedJobConfig;
import com.app.modules.batch.entity.LocalizationBatch;
import com.app.modules.batch.repository.LocalizationBatchRepository;
import com.app.modules.batch.service.BatchCreateRateLimiter;
import com.app.modules.media_job.dto.CreateMediaJobRequest;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.workspace.service.WorkspaceAccessService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class BatchServiceImplTest {

    @Mock private LocalizationBatchRepository localizationBatchRepository;
    @Mock private WorkspaceAccessService access;
    @Mock private MediaJobService mediaJobService;
    @Mock private BatchCreateRateLimiter rateLimiter;

    private BatchServiceImpl service;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new BatchServiceImpl(localizationBatchRepository, access, mediaJobService, rateLimiter, new ObjectMapper());
    }

    private CreateBatchRequest request(List<UUID> assetIds) {
        return new CreateBatchRequest("My batch", assetIds, "en",
                new SharedJobConfig("TRANSLATE_ONLY", "SOFT_SUB", "ORIGINAL_ONLY", false,
                        null, null, "MANUAL", null));
    }

    // ---- createBatch ----

    @Test
    void createBatch_success_createsOneChildJobPerAsset() {
        List<UUID> assetIds = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        when(rateLimiter.isRateLimited(userId)).thenReturn(false);
        when(localizationBatchRepository.save(any(LocalizationBatch.class))).thenAnswer(inv -> {
            LocalizationBatch b = inv.getArgument(0);
            if (b.getId() == null) b.setId(UUID.randomUUID());
            return b;
        });

        LocalizationBatch batch = service.createBatch(workspaceId, userId, projectId, request(assetIds));

        verify(access).requireProjectWriteAccess(workspaceId, userId, projectId);
        assertEquals(LocalizationBatch.BatchStatus.PENDING, batch.getStatus());
        assertEquals(assetIds, batch.getSourceAssetIds());
        assertTrue(batch.getSharedConfig().contains("TRANSLATE_ONLY"));

        ArgumentCaptor<CreateMediaJobRequest> captor = ArgumentCaptor.forClass(CreateMediaJobRequest.class);
        verify(mediaJobService, times(3)).createBatchChildJob(eq(workspaceId), eq(userId), eq(batch.getId()), captor.capture());
        for (CreateMediaJobRequest req : captor.getAllValues()) {
            assertEquals(MediaJob.RECIPE_LOCALIZATION_FULL, req.recipeId());
            assertEquals("en", req.targetLang());
            assertEquals("TRANSLATE_ONLY", req.processingMode());
        }
        assertEquals(assetIds, captor.getAllValues().stream().map(CreateMediaJobRequest::rootAssetId).toList());
    }

    @Test
    void createBatch_emptyAssetList_throwsBatchSizeExceeded() {
        AppException ex = assertThrows(AppException.class, () ->
                service.createBatch(workspaceId, userId, projectId, request(List.of())));
        assertEquals(ErrorCode.BATCH_SIZE_EXCEEDED, ex.getErrorCode());
        verifyNoInteractions(mediaJobService, rateLimiter);
    }

    @Test
    void createBatch_moreThan20Assets_throwsBatchSizeExceeded() {
        List<UUID> assetIds = IntStream.range(0, 21).mapToObj(i -> UUID.randomUUID()).toList();

        AppException ex = assertThrows(AppException.class, () ->
                service.createBatch(workspaceId, userId, projectId, request(assetIds)));
        assertEquals(ErrorCode.BATCH_SIZE_EXCEEDED, ex.getErrorCode());
        verifyNoInteractions(mediaJobService);
    }

    @Test
    void createBatch_rateLimited_throwsBatchRateLimitExceeded() {
        when(rateLimiter.isRateLimited(userId)).thenReturn(true);

        AppException ex = assertThrows(AppException.class, () ->
                service.createBatch(workspaceId, userId, projectId, request(List.of(UUID.randomUUID()))));
        assertEquals(ErrorCode.BATCH_RATE_LIMIT_EXCEEDED, ex.getErrorCode());
        verifyNoInteractions(mediaJobService);
        verify(localizationBatchRepository, never()).save(any());
    }

    // ---- cancelBatch ----

    private LocalizationBatch existingBatch(UUID batchId, LocalizationBatch.BatchStatus status) {
        LocalizationBatch batch = new LocalizationBatch();
        batch.setId(batchId);
        batch.setWorkspaceId(workspaceId);
        batch.setProjectId(projectId);
        batch.setStatus(status);
        return batch;
    }

    private MediaJob childJob(UUID batchId, MediaJob.JobStatus status) {
        MediaJob job = new MediaJob();
        job.setId(UUID.randomUUID());
        job.setBatchId(batchId);
        job.setStatus(status);
        return job;
    }

    @Test
    void cancelBatch_cancelsOnlyPendingAndProcessingChildren() {
        UUID batchId = UUID.randomUUID();
        LocalizationBatch batch = existingBatch(batchId, LocalizationBatch.BatchStatus.PROCESSING);
        when(localizationBatchRepository.findByIdAndWorkspaceId(batchId, workspaceId)).thenReturn(Optional.of(batch));
        when(localizationBatchRepository.findWithLockById(batchId)).thenReturn(Optional.of(batch));
        when(localizationBatchRepository.save(any(LocalizationBatch.class))).thenAnswer(inv -> inv.getArgument(0));

        MediaJob pending = childJob(batchId, MediaJob.JobStatus.PENDING);
        MediaJob completed = childJob(batchId, MediaJob.JobStatus.COMPLETED);
        MediaJob processing = childJob(batchId, MediaJob.JobStatus.PROCESSING);
        when(mediaJobService.getJobsByBatch(batchId)).thenReturn(List.of(pending, completed, processing));

        LocalizationBatch result = service.cancelBatch(workspaceId, userId, batchId);

        verify(mediaJobService).cancelJob(workspaceId, userId, pending.getId());
        verify(mediaJobService).cancelJob(workspaceId, userId, processing.getId());
        verify(mediaJobService, never()).cancelJob(workspaceId, userId, completed.getId());
        assertEquals(LocalizationBatch.BatchStatus.CANCELLED, result.getStatus());
    }

    // ---- retryChildJob ----

    @Test
    void retryChildJob_jobNotInThisBatch_throwsValidationError() {
        UUID batchId = UUID.randomUUID();
        LocalizationBatch batch = existingBatch(batchId, LocalizationBatch.BatchStatus.PARTIALLY_FAILED);
        when(localizationBatchRepository.findByIdAndWorkspaceId(batchId, workspaceId)).thenReturn(Optional.of(batch));
        MediaJob job = childJob(UUID.randomUUID(), MediaJob.JobStatus.FAILED); // different batch
        when(mediaJobService.getJob(workspaceId, userId, job.getId())).thenReturn(job);

        AppException ex = assertThrows(AppException.class, () ->
                service.retryChildJob(workspaceId, userId, batchId, job.getId()));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
        verify(mediaJobService, never()).rerunFromStage(any(), any(), any(), any());
    }

    @Test
    void retryChildJob_jobNotFailed_throwsValidationError() {
        UUID batchId = UUID.randomUUID();
        LocalizationBatch batch = existingBatch(batchId, LocalizationBatch.BatchStatus.PROCESSING);
        when(localizationBatchRepository.findByIdAndWorkspaceId(batchId, workspaceId)).thenReturn(Optional.of(batch));
        MediaJob job = childJob(batchId, MediaJob.JobStatus.COMPLETED);
        when(mediaJobService.getJob(workspaceId, userId, job.getId())).thenReturn(job);

        AppException ex = assertThrows(AppException.class, () ->
                service.retryChildJob(workspaceId, userId, batchId, job.getId()));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    @Test
    void retryChildJob_success_reRunsFromFailedStageAndRecomputesToProcessing() {
        UUID batchId = UUID.randomUUID();
        LocalizationBatch batch = existingBatch(batchId, LocalizationBatch.BatchStatus.FAILED);
        when(localizationBatchRepository.findByIdAndWorkspaceId(batchId, workspaceId)).thenReturn(Optional.of(batch));
        when(localizationBatchRepository.findWithLockById(batchId)).thenReturn(Optional.of(batch));
        when(localizationBatchRepository.save(any(LocalizationBatch.class))).thenAnswer(inv -> inv.getArgument(0));

        MediaJob job = childJob(batchId, MediaJob.JobStatus.FAILED);
        when(mediaJobService.getJob(workspaceId, userId, job.getId())).thenReturn(job);

        MediaJobStage failedStage = new MediaJobStage();
        failedStage.setStageName(MediaJobStage.StageName.TRANSLATE);
        failedStage.setStatus(MediaJobStage.StageStatus.FAILED);
        MediaJobStage otherStage = new MediaJobStage();
        otherStage.setStageName(MediaJobStage.StageName.EXTRACT_AUDIO);
        otherStage.setStatus(MediaJobStage.StageStatus.COMPLETED);
        when(mediaJobService.getStages(job.getId())).thenReturn(List.of(otherStage, failedStage));

        MediaJob retried = childJob(batchId, MediaJob.JobStatus.PENDING);
        when(mediaJobService.rerunFromStage(workspaceId, userId, job.getId(), MediaJobStage.StageName.TRANSLATE))
                .thenReturn(retried);
        when(mediaJobService.getJobsByBatch(batchId)).thenReturn(List.of(retried));

        MediaJob result = service.retryChildJob(workspaceId, userId, batchId, job.getId());

        assertSame(retried, result);
        assertEquals(LocalizationBatch.BatchStatus.PROCESSING, batch.getStatus());
    }

    @Test
    void retryChildJob_batchAlreadyCancelled_recomputeDoesNotOverride() {
        UUID batchId = UUID.randomUUID();
        LocalizationBatch batch = existingBatch(batchId, LocalizationBatch.BatchStatus.CANCELLED);
        when(localizationBatchRepository.findByIdAndWorkspaceId(batchId, workspaceId)).thenReturn(Optional.of(batch));
        when(localizationBatchRepository.findWithLockById(batchId)).thenReturn(Optional.of(batch));

        MediaJob job = childJob(batchId, MediaJob.JobStatus.FAILED);
        when(mediaJobService.getJob(workspaceId, userId, job.getId())).thenReturn(job);
        MediaJobStage failedStage = new MediaJobStage();
        failedStage.setStageName(MediaJobStage.StageName.RENDER);
        failedStage.setStatus(MediaJobStage.StageStatus.FAILED);
        when(mediaJobService.getStages(job.getId())).thenReturn(List.of(failedStage));
        MediaJob retried = childJob(batchId, MediaJob.JobStatus.PENDING);
        when(mediaJobService.rerunFromStage(workspaceId, userId, job.getId(), MediaJobStage.StageName.RENDER))
                .thenReturn(retried);

        service.retryChildJob(workspaceId, userId, batchId, job.getId());

        assertEquals(LocalizationBatch.BatchStatus.CANCELLED, batch.getStatus());
        verify(localizationBatchRepository, never()).save(any());
        verify(mediaJobService, never()).getJobsByBatch(batchId);
    }
}
