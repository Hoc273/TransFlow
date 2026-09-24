package com.app.modules.media_job.callback.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.batch.service.BatchService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.notification.service.NotificationService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MediaCallbackServiceImplTest {

    @Mock private MediaJobRepository mediaJobRepository;
    @Mock private MediaJobStageRepository mediaJobStageRepository;
    @Mock private NotificationService notification;
    @Mock private BatchService batchService;

    private MediaCallbackServiceImpl service;

    private final UUID jobId = UUID.randomUUID();
    private final UUID stageId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new MediaCallbackServiceImpl(mediaJobRepository, mediaJobStageRepository, notification, batchService);
    }

    private MediaJob job(MediaJob.JobStatus status, UUID batchId) {
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setWorkspaceId(UUID.randomUUID());
        job.setCreatedByUserId(UUID.randomUUID());
        job.setStatus(status);
        job.setBatchId(batchId);
        return job;
    }

    private MediaJobStage stage(MediaJobStage.StageName name, MediaJobStage.StageStatus status) {
        MediaJobStage stage = new MediaJobStage();
        stage.setId(stageId);
        stage.setMediaJobId(jobId);
        stage.setStageName(name);
        stage.setStatus(status);
        return stage;
    }

    // ---- updateProgress ----

    @Test
    void updateProgress_pendingStage_transitionsToProcessingAndSetsStartedAt() {
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job(MediaJob.JobStatus.PENDING, null)));
        MediaJobStage stage = stage(MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.PENDING);
        when(mediaJobStageRepository.findById(stageId)).thenReturn(Optional.of(stage));

        service.updateProgress(jobId, stageId, MediaJobStage.StageName.EXTRACT_AUDIO, (short) 40);

        assertEquals(MediaJobStage.StageStatus.PROCESSING, stage.getStatus());
        assertEquals(40, stage.getProgressPercent());
        assertNotNull(stage.getStartedAt());
        verify(mediaJobRepository).save(argThat(j -> j.getStatus() == MediaJob.JobStatus.PROCESSING));
    }

    @Test
    void updateProgress_stageBelongsToDifferentJob_throwsValidationError() {
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job(MediaJob.JobStatus.PROCESSING, null)));
        MediaJobStage stage = stage(MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.PENDING);
        stage.setMediaJobId(UUID.randomUUID()); // different job
        when(mediaJobStageRepository.findById(stageId)).thenReturn(Optional.of(stage));

        AppException ex = assertThrows(AppException.class, () ->
                service.updateProgress(jobId, stageId, MediaJobStage.StageName.EXTRACT_AUDIO, (short) 10));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    @Test
    void updateProgress_stageNameMismatch_throwsValidationError() {
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job(MediaJob.JobStatus.PROCESSING, null)));
        MediaJobStage stage = stage(MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.PENDING);
        when(mediaJobStageRepository.findById(stageId)).thenReturn(Optional.of(stage));

        AppException ex = assertThrows(AppException.class, () ->
                service.updateProgress(jobId, stageId, MediaJobStage.StageName.RENDER, (short) 10));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    // ---- completeStage ----

    @Test
    void completeStage_failure_setsJobFailedAndNotifies() {
        MediaJob job = job(MediaJob.JobStatus.PROCESSING, null);
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        MediaJobStage stage = stage(MediaJobStage.StageName.RENDER, MediaJobStage.StageStatus.PROCESSING);
        when(mediaJobStageRepository.findById(stageId)).thenReturn(Optional.of(stage));

        service.completeStage(jobId, stageId, MediaJobStage.StageName.RENDER, false, null, "ffmpeg crashed");

        assertEquals(MediaJobStage.StageStatus.FAILED, stage.getStatus());
        assertEquals("ffmpeg crashed", stage.getErrorMessage());
        assertEquals(MediaJob.JobStatus.FAILED, job.getStatus());
        verify(notification).notify(eq(job.getWorkspaceId()), eq(job.getCreatedByUserId()), eq("JOB_FAILED"), eq(jobId), any());
        verifyNoInteractions(batchService);
    }

    @Test
    void completeStage_structuredAiFailurePersistsCodeAndSafeDetail() throws Exception {
        MediaJob job = job(MediaJob.JobStatus.PROCESSING, null);
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        MediaJobStage stage = stage(MediaJobStage.StageName.TRANSLATE, MediaJobStage.StageStatus.PROCESSING);
        when(mediaJobStageRepository.findById(stageId)).thenReturn(Optional.of(stage));
        JsonNode detail = new ObjectMapper().readTree("""
                {"errorCode":"PROVIDER_QUOTA_EXCEEDED","title":"Quota Exceeded",
                 "message":"Provider quota has been exhausted","retryable":false,
                 "recommendedAction":"Check billing or choose another provider"}
                """);

        service.completeStage(jobId, stageId, MediaJobStage.StageName.TRANSLATE, false, null,
                "Provider quota has been exhausted", "PROVIDER_QUOTA_EXCEEDED", detail);

        assertEquals(MediaJobStage.StageStatus.FAILED, stage.getStatus());
        assertEquals("PROVIDER_QUOTA_EXCEEDED", stage.getErrorCode());
        assertEquals("Provider quota has been exhausted", stage.getErrorMessage());
        assertEquals("Check billing or choose another provider", stage.getErrorDetail().path("recommendedAction").asText());
        assertEquals(MediaJob.JobStatus.FAILED, job.getStatus());
        verify(notification).notify(eq(job.getWorkspaceId()), eq(job.getCreatedByUserId()), eq("JOB_FAILED"),
                eq(jobId), eq("Stage TRANSLATE failed (PROVIDER_QUOTA_EXCEEDED): Provider quota has been exhausted"));
    }

    @Test
    void completeStage_successWithMoreStagesPending_setsJobProcessing() {
        MediaJob job = job(MediaJob.JobStatus.PROCESSING, null);
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        MediaJobStage stage = stage(MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.PROCESSING);
        stage.setErrorMessage("old failure");
        stage.setErrorCode("PROVIDER_UNKNOWN");
        stage.setErrorDetail(new ObjectMapper().createObjectNode().put("errorCode", "PROVIDER_UNKNOWN"));
        when(mediaJobStageRepository.findById(stageId)).thenReturn(Optional.of(stage));
        MediaJobStage nextStage = stage(MediaJobStage.StageName.STT, MediaJobStage.StageStatus.PENDING);
        when(mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId)).thenReturn(List.of(stage, nextStage));

        JsonNode outputRef = new ObjectMapper().createObjectNode().put("key", "audio/123.wav");
        service.completeStage(jobId, stageId, MediaJobStage.StageName.EXTRACT_AUDIO, true, outputRef, null);

        assertEquals(MediaJobStage.StageStatus.COMPLETED, stage.getStatus());
        assertNull(stage.getErrorMessage());
        assertNull(stage.getErrorCode());
        assertNull(stage.getErrorDetail());
        assertTrue(stage.getOutputRef().contains("audio/123.wav"));
        assertEquals(MediaJob.JobStatus.PROCESSING, job.getStatus());
        verifyNoInteractions(notification);
    }

    @Test
    void completeStage_successOnLastStage_setsJobCompletedAndNotifies() {
        MediaJob job = job(MediaJob.JobStatus.PROCESSING, null);
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        MediaJobStage renderStage = stage(MediaJobStage.StageName.RENDER, MediaJobStage.StageStatus.PROCESSING);
        when(mediaJobStageRepository.findById(stageId)).thenReturn(Optional.of(renderStage));
        MediaJobStage completedEarlier = stage(MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.COMPLETED);
        MediaJobStage skippedOne = stage(MediaJobStage.StageName.SOURCE_SEPARATION, MediaJobStage.StageStatus.SKIPPED);
        when(mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId))
                .thenReturn(List.of(completedEarlier, skippedOne, renderStage));

        service.completeStage(jobId, stageId, MediaJobStage.StageName.RENDER, true, null, null);

        assertEquals(MediaJob.JobStatus.COMPLETED, job.getStatus());
        verify(notification).notify(eq(job.getWorkspaceId()), eq(job.getCreatedByUserId()), eq("JOB_COMPLETED"), eq(jobId), any());
    }

    @Test
    void completeStage_jobBelongsToBatch_recomputesBatchStatus() {
        UUID batchId = UUID.randomUUID();
        MediaJob job = job(MediaJob.JobStatus.PROCESSING, batchId);
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        MediaJobStage stage = stage(MediaJobStage.StageName.RENDER, MediaJobStage.StageStatus.PROCESSING);
        when(mediaJobStageRepository.findById(stageId)).thenReturn(Optional.of(stage));
        when(mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId)).thenReturn(List.of(stage));

        service.completeStage(jobId, stageId, MediaJobStage.StageName.RENDER, true, null, null);

        verify(batchService).recomputeStatus(batchId);
    }

    @Test
    void completeStage_jobNotFound_throwsResourceNotFound() {
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class, () ->
                service.completeStage(jobId, stageId, MediaJobStage.StageName.RENDER, true, null, null));
        assertEquals(ErrorCode.RESOURCE_NOT_FOUND, ex.getErrorCode());
    }
}
