package com.app.modules.media_job.pipeline;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Advances the persisted linear graph one stage at a time.  The pessimistic
 * job lock is deliberately held while claiming a stage; duplicate deliveries
 * therefore cannot publish two executions for the same stage attempt.
 */
@Service
@ConditionalOnProperty(name = "app.pipeline.enabled", havingValue = "true", matchIfMissing = true)
public class MediaPipelineDispatcher {

    private static final Logger log = LoggerFactory.getLogger(MediaPipelineDispatcher.class);

    private final MediaJobRepository jobRepository;
    private final MediaJobStageRepository stageRepository;
    private final MediaStageMessagePublisher publisher;
    private final RestClient workerClient;

    public MediaPipelineDispatcher(MediaJobRepository jobRepository,
                                   MediaJobStageRepository stageRepository,
                                   MediaStageMessagePublisher publisher,
                                   AppProperties props) {
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.publisher = publisher;
        this.workerClient = RestClient.builder().baseUrl(props.mediaWorker().baseUrl()).build();
    }

    /** Claim and publish the first runnable stage, if any. */
    @Transactional
    public void dispatchNext(UUID jobId) {
        MediaJob job = jobRepository.findWithLockById(jobId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        if (job.getStatus() == MediaJob.JobStatus.CANCELLED
                || job.getStatus() == MediaJob.JobStatus.FAILED
                || job.getStatus() == MediaJob.JobStatus.COMPLETED) {
            return;
        }

        List<MediaJobStage> stages = stageRepository.findByMediaJobIdOrderByStageOrder(jobId);
        for (MediaJobStage stage : stages) {
            if (stage.getStatus() == MediaJobStage.StageStatus.COMPLETED
                    || stage.getStatus() == MediaJobStage.StageStatus.SKIPPED
                    || stage.getStatus() == MediaJobStage.StageStatus.CANCELLED) {
                continue;
            }
            if (stage.getStatus() == MediaJobStage.StageStatus.PROCESSING
                    || stage.getStatus() == MediaJobStage.StageStatus.CANCEL_REQUESTED
                    || stage.getStatus() == MediaJobStage.StageStatus.FAILED) {
                return;
            }
            if (!predecessorsSettled(stages, stage)) {
                return;
            }
            if (blockedByManualCheckpoint(job, stage)) {
                return;
            }

            UUID correlationId = UUID.randomUUID();
            stage.setStatus(MediaJobStage.StageStatus.PROCESSING);
            stage.setStartedAt(Instant.now());
            stage.setCompletedAt(null);
            stage.setErrorMessage(null);
            stage.setWorkerId(correlationId.toString());
            stage.setAttemptCount((short) (stage.getAttemptCount() + 1));
            stageRepository.save(stage);
            job.setStatus(MediaJob.JobStatus.PROCESSING);
            jobRepository.save(job);
            publisher.publish(new MediaStageMessage(jobId, stage.getId(), stage.getStageName().name(),
                    correlationId, stage.getAttemptCount()));
            return;
        }

        if (stages.stream().allMatch(s -> s.getStatus() == MediaJobStage.StageStatus.COMPLETED
                || s.getStatus() == MediaJobStage.StageStatus.SKIPPED
                || s.getStatus() == MediaJobStage.StageStatus.CANCELLED)) {
            boolean cancelled = stages.stream().anyMatch(s -> s.getStatus() == MediaJobStage.StageStatus.CANCELLED);
            if (!cancelled) {
                job.setStatus(MediaJob.JobStatus.COMPLETED);
                jobRepository.save(job);
            }
        }
    }

    /** Request graceful cancellation after the transaction that set CANCEL_REQUESTED commits. */
    public void requestCancellationAfterCommit(UUID jobId) {
        Runnable request = () -> requestCancellation(jobId);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    request.run();
                }
            });
        } else {
            request.run();
        }
    }

    public void requestCancellation(UUID jobId) {
        List<MediaJobStage> stages = stageRepository.findByMediaJobIdOrderByStageOrder(jobId);
        for (MediaJobStage stage : stages) {
            if (stage.getStatus() != MediaJobStage.StageStatus.CANCEL_REQUESTED
                    || stage.getWorkerId() == null || stage.getWorkerId().isBlank()) {
                continue;
            }
            String path = switch (stage.getStageName()) {
                case AUDIO_MIX -> "/internal/media/audio-mix/";
                case RENDER -> "/internal/media/render/";
                default -> null;
            };
            if (path == null) {
                continue;
            }
            try {
                workerClient.post().uri(path + stage.getWorkerId() + "/cancel").retrieve().toBodilessEntity();
            } catch (Exception ex) {
                // Callback remains authoritative. Keep CANCEL_REQUESTED visible for retry/ops.
                log.warn("Worker cancellation request failed job={} stage={} correlation={}: {}",
                        jobId, stage.getStageName(), stage.getWorkerId(), ex.getMessage());
            }
        }
    }

    private boolean predecessorsSettled(List<MediaJobStage> stages, MediaJobStage current) {
        return stages.stream().filter(s -> s.getStageOrder() < current.getStageOrder())
                .allMatch(s -> s.getStatus() == MediaJobStage.StageStatus.COMPLETED
                        || s.getStatus() == MediaJobStage.StageStatus.SKIPPED);
    }

    private boolean blockedByManualCheckpoint(MediaJob job, MediaJobStage stage) {
        if (job.getWorkflowMode() != MediaJob.WorkflowMode.MANUAL) {
            return false;
        }
        String checkpoint = switch (stage.getStageName()) {
            case TRANSLATE -> "CUT_CONFIRMED";
            case TTS -> "REVIEW_CONFIRMED";
            case RENDER -> "PUBLISH_CONFIRMED";
            default -> null;
        };
        if (checkpoint == null) {
            return false;
        }
        return stageRepository.findByMediaJobIdAndStageName(job.getId(), stage.getStageName())
                .map(owner -> owner.getInputRef() == null
                        || !owner.getInputRef().toUpperCase(Locale.ROOT).contains(checkpoint))
                .orElse(true);
    }
}
