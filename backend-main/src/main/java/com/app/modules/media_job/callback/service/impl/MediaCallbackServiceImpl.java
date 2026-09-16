package com.app.modules.media_job.callback.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.batch.service.BatchService;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.notification.service.NotificationService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class MediaCallbackServiceImpl implements MediaCallbackService {

    private final MediaJobRepository mediaJobRepository;
    private final MediaJobStageRepository mediaJobStageRepository;
    private final NotificationService notification;
    private final BatchService batchService;

    public MediaCallbackServiceImpl(MediaJobRepository mediaJobRepository,
                                     MediaJobStageRepository mediaJobStageRepository,
                                     NotificationService notification,
                                     BatchService batchService) {
        this.mediaJobRepository = mediaJobRepository;
        this.mediaJobStageRepository = mediaJobStageRepository;
        this.notification = notification;
        this.batchService = batchService;
    }

    @Override
    @Transactional
    public void updateProgress(UUID jobId, UUID stageId, MediaJobStage.StageName expectedStage, short progressPercent) {
        MediaJob job = requireJobLocked(jobId);
        MediaJobStage stage = requireStage(jobId, stageId, expectedStage);

        stage.setProgressPercent(progressPercent);
        if (stage.getStatus() == MediaJobStage.StageStatus.PENDING) {
            stage.setStatus(MediaJobStage.StageStatus.PROCESSING);
            stage.setStartedAt(Instant.now());
        }
        mediaJobStageRepository.save(stage);

        if (job.getStatus() == MediaJob.JobStatus.PENDING) {
            job.setStatus(MediaJob.JobStatus.PROCESSING);
            mediaJobRepository.save(job);
        }
    }

    @Override
    @Transactional
    public void completeStage(UUID jobId, UUID stageId, MediaJobStage.StageName expectedStage,
                               boolean success, JsonNode outputRef, String errorMessage) {
        MediaJob job = requireJobLocked(jobId);
        MediaJobStage stage = requireStage(jobId, stageId, expectedStage);

        stage.setCompletedAt(Instant.now());
        stage.setOutputRef(outputRef != null ? outputRef.toString() : null);
        stage.setStatus(success ? MediaJobStage.StageStatus.COMPLETED : MediaJobStage.StageStatus.FAILED);
        stage.setErrorMessage(success ? null : errorMessage);
        mediaJobStageRepository.save(stage);

        if (!success) {
            job.setStatus(MediaJob.JobStatus.FAILED);
            mediaJobRepository.save(job);
            notification.notify(job.getWorkspaceId(), job.getCreatedByUserId(), "JOB_FAILED", jobId,
                    "Stage " + expectedStage + " failed" + (errorMessage != null ? ": " + errorMessage : ""));
        } else {
            List<MediaJobStage> stages = mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId);
            boolean hasMoreWork = stages.stream().anyMatch(s ->
                    s.getStatus() != MediaJobStage.StageStatus.COMPLETED && s.getStatus() != MediaJobStage.StageStatus.SKIPPED);
            if (hasMoreWork) {
                job.setStatus(MediaJob.JobStatus.PROCESSING);
                mediaJobRepository.save(job);
            } else {
                job.setStatus(MediaJob.JobStatus.COMPLETED);
                mediaJobRepository.save(job);
                notification.notify(job.getWorkspaceId(), job.getCreatedByUserId(), "JOB_COMPLETED", jobId,
                        "Media job completed");
            }
        }

        if (job.getBatchId() != null) {
            batchService.recomputeStatus(job.getBatchId());
        }
    }

    private MediaJob requireJobLocked(UUID jobId) {
        return mediaJobRepository.findWithLockById(jobId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
    }

    private MediaJobStage requireStage(UUID jobId, UUID stageId, MediaJobStage.StageName expectedStage) {
        MediaJobStage stage = mediaJobStageRepository.findById(stageId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        if (!stage.getMediaJobId().equals(jobId) || stage.getStageName() != expectedStage) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        return stage;
    }
}
