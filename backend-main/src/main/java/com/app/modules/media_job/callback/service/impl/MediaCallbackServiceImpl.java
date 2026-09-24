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
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class MediaCallbackServiceImpl implements MediaCallbackService {

    private static final Logger log = LoggerFactory.getLogger(MediaCallbackServiceImpl.class);

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
        completeStage(jobId, stageId, expectedStage, success, outputRef, errorMessage, null, null);
    }

    @Override
    @Transactional
    public void completeStage(UUID jobId, UUID stageId, MediaJobStage.StageName expectedStage,
                              boolean success, JsonNode outputRef, String errorMessage,
                              String errorCode, JsonNode errorDetail) {
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
            stage.setErrorCode(null);
            stage.setErrorDetail(null);
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
        stage.setErrorCode(success ? null : errorCode);
        stage.setErrorDetail(success ? null : failureDetail(errorDetail, errorCode, errorMessage));
        mediaJobStageRepository.save(stage);

        if (!success) {
            job.setStatus(MediaJob.JobStatus.FAILED);
            mediaJobRepository.save(job);
            notification.notify(job.getWorkspaceId(), job.getCreatedByUserId(), "JOB_FAILED", jobId,
                    safeFailureNotification(expectedStage, errorCode, stage.getErrorDetail()));
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

    @Override
    @Transactional
    public void completeStage(UUID jobId, UUID stageId, MediaJobStage.StageName expectedStage,
                              boolean success, JsonNode outputRef, String errorMessage,
                              String errorCode, JsonNode errorDetail, String dedupeKey) {
        // Dedupe keys are "<stage>:<correlation>:complete". A stage re-dispatched after a
        // timeout carries a new correlation, so a late result of the old attempt is stale.
        String correlation = correlationOf(dedupeKey);
        if (correlation != null) {
            requireJobLocked(jobId);
            MediaJobStage stage = requireStage(jobId, stageId, expectedStage);
            if (stage.getWorkerId() != null && !stage.getWorkerId().equals(correlation)) {
                log.warn("Ignoring {} callback of a superseded attempt job={} correlation={} current={}",
                        expectedStage, jobId, correlation, stage.getWorkerId());
                return;
            }
        }
        completeStage(jobId, stageId, expectedStage, success, outputRef, errorMessage, errorCode, errorDetail);
    }

    private static String correlationOf(String dedupeKey) {
        if (dedupeKey == null) {
            return null;
        }
        String[] parts = dedupeKey.split(":");
        return parts.length >= 3 && !parts[1].isBlank() ? parts[1] : null;
    }

    private JsonNode failureDetail(JsonNode provided, String errorCode, String errorMessage) {
        if (provided != null && provided.isObject()) return provided;
        if (errorCode == null) return null;
        ObjectNode detail = JsonNodeFactory.instance.objectNode();
        detail.put("errorCode", errorCode);
        if (errorMessage != null) detail.put("message", errorMessage);
        return detail;
    }

    private String safeFailureNotification(MediaJobStage.StageName stage, String errorCode, JsonNode detail) {
        String message = detail == null ? null : detail.path("message").asText(null);
        String code = errorCode == null || errorCode.isBlank() ? "" : " (" + errorCode + ")";
        if (message != null && !message.isBlank()) return "Stage " + stage + " failed" + code + ": " + message;
        if (!code.isBlank()) return "Stage " + stage + " failed" + code;
        return "Stage " + stage + " failed";
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
