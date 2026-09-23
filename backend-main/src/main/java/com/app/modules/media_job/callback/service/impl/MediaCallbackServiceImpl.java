package com.app.modules.media_job.callback.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.batch.service.BatchService;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.pipeline.MediaPipelineDispatcher;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.notification.service.NotificationService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Autowired;
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
    private final MediaPipelineDispatcher mediaPipelineDispatcher;

    @Autowired
    public MediaCallbackServiceImpl(MediaJobRepository mediaJobRepository,
                                     MediaJobStageRepository mediaJobStageRepository,
                                     NotificationService notification,
                                     BatchService batchService,
                                     MediaPipelineDispatcher mediaPipelineDispatcher) {
        this.mediaJobRepository = mediaJobRepository;
        this.mediaJobStageRepository = mediaJobStageRepository;
        this.notification = notification;
        this.batchService = batchService;
        this.mediaPipelineDispatcher = mediaPipelineDispatcher;
    }

    /** Compatibility constructor for focused unit tests that do not exercise queue dispatch. */
    public MediaCallbackServiceImpl(MediaJobRepository mediaJobRepository,
                                    MediaJobStageRepository mediaJobStageRepository,
                                    NotificationService notification,
                                    BatchService batchService) {
        this(mediaJobRepository, mediaJobStageRepository, notification, batchService, null);
    }

    @Override
    @Transactional
    public void updateProgress(UUID jobId, UUID stageId, MediaJobStage.StageName expectedStage, short progressPercent) {
        MediaJob job = requireJobLocked(jobId);
        MediaJobStage stage = requireStage(jobId, stageId, expectedStage);

        if (isTerminal(stage.getStatus()) || stage.getStatus() == MediaJobStage.StageStatus.CANCEL_REQUESTED) {
            return;
        }

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

        MediaJobStage.StageStatus currentStatus = stage.getStatus();
        if (isTerminal(currentStatus)) {
            return;
        }

        if (currentStatus == MediaJobStage.StageStatus.CANCEL_REQUESTED
                || job.getStatus() == MediaJob.JobStatus.CANCELLED) {
            stage.setStatus(MediaJobStage.StageStatus.CANCELLED);
            stage.setCompletedAt(Instant.now());
            stage.setErrorMessage(null);
            mediaJobStageRepository.save(stage);

            List<MediaJobStage> stages = mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId);
            boolean allTerminal = stages.stream().allMatch(this::isTerminal);
            if (allTerminal) {
                job.setStatus(MediaJob.JobStatus.CANCELLED);
                mediaJobRepository.save(job);
            }
            if (job.getBatchId() != null) {
                batchService.recomputeStatus(job.getBatchId());
            }
            return;
        }

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

        if (success && mediaPipelineDispatcher != null) {
            mediaPipelineDispatcher.dispatchNext(jobId);
        }
    }

    private boolean isTerminal(MediaJobStage stage) {
        return isTerminal(stage.getStatus());
    }

    private boolean isTerminal(MediaJobStage.StageStatus status) {
        return status == MediaJobStage.StageStatus.COMPLETED
                || status == MediaJobStage.StageStatus.FAILED
                || status == MediaJobStage.StageStatus.SKIPPED
                || status == MediaJobStage.StageStatus.CANCELLED;
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
