package com.app.modules.media_job.pipeline;

import com.app.common.exception.AiStageException;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Recovers attempts whose result never arrived (lost worker callback, worker or
 * backend restart, hung provider). Mirrors the original stuck-stage monitor:
 * an overdue attempt is re-dispatched under a new correlation up to the stage's
 * attempt budget, then fails with {@code STAGE_TIMEOUT}; a cancel nobody
 * acknowledged is finalized as CANCELLED. Late results of a superseded attempt
 * are ignored by the callback's correlation check.
 */
@Service
public class MediaStageRecoveryService {

    private static final Logger log = LoggerFactory.getLogger(MediaStageRecoveryService.class);

    /** Per-stage budget; each exceeds the stage's own internal timeouts and retry rounds. */
    static final Map<MediaJobStage.StageName, Duration> TIME_BUDGET = Map.of(
            MediaJobStage.StageName.EXTRACT_AUDIO, Duration.ofMinutes(15),
            MediaJobStage.StageName.SOURCE_SEPARATION, Duration.ofMinutes(30),
            MediaJobStage.StageName.STT, Duration.ofMinutes(25),
            MediaJobStage.StageName.SUMMARIZE, Duration.ofMinutes(15),
            MediaJobStage.StageName.TRANSLATE, Duration.ofMinutes(20),
            MediaJobStage.StageName.TTS, Duration.ofMinutes(30),
            MediaJobStage.StageName.AUDIO_MIX, Duration.ofMinutes(20),
            // Worker hard-sub burn alone may take up to 30 min.
            MediaJobStage.StageName.RENDER, Duration.ofMinutes(45));

    static final Duration SHORTEST_BUDGET = TIME_BUDGET.values().stream().min(Duration::compareTo).orElseThrow();

    private static final int MAX_ATTEMPTS = 3;
    private static final int MAX_RENDER_ATTEMPTS = 2;
    /** Attempts a stage may consume while failing over across keys of the platform pool. */
    public static final int MAX_FAILOVER_ATTEMPTS = 4;
    /** Attempts a stage may consume while waiting out rate limits / provider outages. */
    public static final int MAX_DEFERRED_ATTEMPTS = 5;

    private final MediaJobRepository jobRepository;
    private final MediaJobStageRepository stageRepository;
    private final MediaCallbackService callbackService;
    private final MediaPipelineDispatcher dispatcher;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private TaskScheduler taskScheduler;

    public MediaStageRecoveryService(MediaJobRepository jobRepository,
                                     MediaJobStageRepository stageRepository,
                                     MediaCallbackService callbackService,
                                     MediaPipelineDispatcher dispatcher) {
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.callbackService = callbackService;
        this.dispatcher = dispatcher;
    }

    @Autowired(required = false)
    void setTaskScheduler(TaskScheduler taskScheduler) {
        this.taskScheduler = taskScheduler;
    }

    /** A worker-side cancel to send once the recovery transaction has committed. */
    public record WorkerCancel(MediaJobStage.StageName stageName, String correlationId) {
    }

    /**
     * Re-evaluates one candidate under the job lock (the same lock callbacks and the
     * dispatcher take), so a result that arrived meanwhile always wins.
     */
    @Transactional
    public Optional<WorkerCancel> recover(UUID jobId, UUID stageId, Instant now) {
        if (jobRepository.findWithLockById(jobId).isEmpty()) {
            return Optional.empty();
        }
        MediaJobStage stage = stageRepository.findById(stageId).orElse(null);
        if (stage == null || stage.getStartedAt() == null || !overdue(stage, now)) {
            return Optional.empty();
        }

        if (stage.getStatus() == MediaJobStage.StageStatus.CANCEL_REQUESTED) {
            log.warn("Cancel of {} was never acknowledged job={} correlation={}; finalizing as CANCELLED",
                    stage.getStageName(), jobId, stage.getWorkerId());
            callbackService.completeStage(jobId, stageId, stage.getStageName(), false, null, null);
            return Optional.empty();
        }
        if (stage.getStatus() != MediaJobStage.StageStatus.PROCESSING) {
            return Optional.empty();
        }

        Optional<WorkerCancel> cancel = workerCancel(stage);
        Duration budget = TIME_BUDGET.get(stage.getStageName());
        if (stage.getAttemptCount() < maxAttempts(stage.getStageName())) {
            log.warn("{} attempt {} got no result within {} job={} correlation={}; retrying",
                    stage.getStageName(), stage.getAttemptCount(), budget, jobId, stage.getWorkerId());
            stage.setStatus(MediaJobStage.StageStatus.PENDING);
            stage.setWorkerId(null);
            stage.setStartedAt(null);
            stage.setErrorMessage("Attempt " + stage.getAttemptCount() + " timed out after "
                    + budget.toMinutes() + " min; retrying");
            stageRepository.save(stage);
            dispatcher.dispatchNext(jobId);
            return cancel;
        }

        String message = stage.getStageName() + " produced no result within " + budget.toMinutes()
                + " min after " + stage.getAttemptCount() + " attempts";
        log.error("{} job={}; failing the stage", message, jobId);
        AiStageException timeout = AiStageException.safeFailure("STAGE_TIMEOUT", message, false,
                "Check that the media worker and AI gateway are running, then rerun this stage.", null, null);
        callbackService.completeStage(jobId, stageId, stage.getStageName(), false, null, message,
                timeout.getErrorCode(), objectMapper.valueToTree(timeout.getErrorDetail()));
        return cancel;
    }

    /**
     * Re-queues a stage whose platform key just failed so the next attempt resolves another key
     * of the pool. Runs under the job lock and only for the attempt identified by
     * {@code correlationId}: a cancel or a newer attempt always wins.
     */
    @Transactional
    public boolean retryOnAnotherProvider(UUID jobId, UUID stageId, String correlationId, String errorCode) {
        if (jobRepository.findWithLockById(jobId).isEmpty()) {
            return false;
        }
        MediaJobStage stage = stageRepository.findById(stageId).orElse(null);
        if (stage == null || stage.getStatus() != MediaJobStage.StageStatus.PROCESSING
                || correlationId == null || !correlationId.equals(stage.getWorkerId())) {
            return false;
        }
        stage.setStatus(MediaJobStage.StageStatus.PENDING);
        stage.setWorkerId(null);
        stage.setStartedAt(null);
        stage.setErrorMessage("Attempt " + stage.getAttemptCount() + " failed (" + errorCode
                + "); retrying with another AI provider");
        stage.setErrorCode(errorCode);
        stage.setErrorDetail(retryDetail("FAILOVER", errorCode, null));
        stageRepository.save(stage);
        dispatcher.dispatchNext(jobId);
        return true;
    }

    /**
     * Puts a stage whose provider is rate limited / temporarily down back to PENDING and dispatches
     * it again after {@code delay}. If the backend restarts meanwhile, the job reconciler picks the
     * idle job up. Same lock and correlation rules as {@link #retryOnAnotherProvider}.
     */
    @Transactional
    public boolean deferRetry(UUID jobId, UUID stageId, String correlationId, String errorCode, Duration delay) {
        MediaJob job = taskScheduler == null ? null : jobRepository.findWithLockById(jobId).orElse(null);
        if (job == null) {
            return false;
        }
        MediaJobStage stage = stageRepository.findById(stageId).orElse(null);
        if (stage == null || stage.getStatus() != MediaJobStage.StageStatus.PROCESSING
                || correlationId == null || !correlationId.equals(stage.getWorkerId())) {
            return false;
        }
        stage.setStatus(MediaJobStage.StageStatus.PENDING);
        stage.setWorkerId(null);
        stage.setStartedAt(null);
        Instant retryAt = Instant.now().plus(delay);
        stage.setErrorMessage("Attempt " + stage.getAttemptCount() + " failed (" + errorCode
                + "); retrying automatically in " + delay.toSeconds() + "s");
        stage.setErrorCode(errorCode);
        stage.setErrorDetail(retryDetail("DEFERRED", errorCode, retryAt));
        stageRepository.save(stage);
        // Fresh activity keeps the idle-job reconciler from dispatching before the delay elapses.
        job.setUpdatedAt(Instant.now());
        jobRepository.save(job);
        taskScheduler.schedule(() -> {
            try {
                dispatcher.dispatchNext(jobId);
            } catch (RuntimeException ex) {
                log.warn("Deferred dispatch of job={} failed; the reconciler will retry: {}", jobId, ex.toString());
            }
        }, retryAt);
        return true;
    }

    /** Structured PENDING reason for the UI; the dispatcher clears it when the retry is claimed. */
    private com.fasterxml.jackson.databind.JsonNode retryDetail(String mode, String errorCode, Instant retryAt) {
        var detail = objectMapper.createObjectNode();
        detail.put("retry", mode);
        detail.put("errorCode", errorCode);
        if (retryAt != null) {
            detail.put("retryAt", retryAt.toString());
        }
        return detail;
    }

    private boolean overdue(MediaJobStage stage, Instant now) {
        Duration budget = TIME_BUDGET.get(stage.getStageName());
        return budget != null && stage.getStartedAt().plus(budget).isBefore(now);
    }

    private int maxAttempts(MediaJobStage.StageName stageName) {
        return stageName == MediaJobStage.StageName.RENDER ? MAX_RENDER_ATTEMPTS : MAX_ATTEMPTS;
    }

    /** Only the worker's long-running stages expose a cancel endpoint. */
    private Optional<WorkerCancel> workerCancel(MediaJobStage stage) {
        boolean cancellable = stage.getStageName() == MediaJobStage.StageName.RENDER
                || stage.getStageName() == MediaJobStage.StageName.AUDIO_MIX;
        return cancellable && stage.getWorkerId() != null && !stage.getWorkerId().isBlank()
                ? Optional.of(new WorkerCancel(stage.getStageName(), stage.getWorkerId()))
                : Optional.empty();
    }
}
