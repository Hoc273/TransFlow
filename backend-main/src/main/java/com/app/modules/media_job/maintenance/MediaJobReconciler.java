package com.app.modules.media_job.maintenance;

import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.pipeline.MediaPipelineDispatcher;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Safety net for open jobs that nobody advances: a crash between a commit and the
 * follow-up {@code dispatchNext} (job creation, callback, checkpoint confirm) leaves the
 * next stage PENDING with no message in flight. {@code dispatchNext} is idempotent and
 * respects checkpoints and QA gates, so re-calling it is safe.
 *
 * <p>Jobs with a running stage belong to {@code MediaStageWatchdog}; jobs with STALE stages
 * wait for an explicit rerun by the user (it is billed), so both are skipped. Open jobs whose
 * source video was deleted by the retention sweep are failed with {@code MEDIA_FILE_EXPIRED}.
 */
@Component
public class MediaJobReconciler {

    private static final Logger log = LoggerFactory.getLogger(MediaJobReconciler.class);

    private static final List<MediaJob.JobStatus> OPEN = List.of(MediaJob.JobStatus.PENDING,
            MediaJob.JobStatus.PROCESSING);
    private static final List<MediaJobStage.StageStatus> HANDS_OFF = List.of(
            MediaJobStage.StageStatus.PROCESSING, MediaJobStage.StageStatus.CANCEL_REQUESTED,
            MediaJobStage.StageStatus.STALE);

    private final MediaJobRepository jobRepository;
    private final MediaJobStageRepository stageRepository;
    private final MediaPipelineDispatcher dispatcher;
    private final MediaJobExpiryService expiryService;
    private final boolean enabled;
    private final Duration idleThreshold;

    public MediaJobReconciler(MediaJobRepository jobRepository,
                              MediaJobStageRepository stageRepository,
                              MediaPipelineDispatcher dispatcher,
                              MediaJobExpiryService expiryService,
                              @Value("${app.pipeline.enabled:true}") boolean pipelineEnabled,
                              @Value("${app.maintenance.enabled:true}") boolean maintenanceEnabled,
                              @Value("${app.maintenance.job-idle-threshold:PT5M}") Duration idleThreshold) {
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.dispatcher = dispatcher;
        this.expiryService = expiryService;
        this.enabled = pipelineEnabled && maintenanceEnabled;
        this.idleThreshold = idleThreshold;
    }

    @Scheduled(fixedDelayString = "${app.maintenance.job-reconciler-interval:PT5M}",
            initialDelayString = "${app.maintenance.initial-delay:PT2M}")
    public void sweep() {
        if (!enabled) {
            return;
        }
        Set<UUID> expired = expireJobsWithPurgedSource();
        redispatchIdleJobs(expired);
    }

    Set<UUID> expireJobsWithPurgedSource() {
        Set<UUID> handled = new HashSet<>();
        for (UUID jobId : jobRepository.findIdsWithPurgedRootAsset(OPEN)) {
            try {
                if (expiryService.expire(jobId)) {
                    handled.add(jobId);
                    log.info("Job {} failed: source media expired", jobId);
                }
            } catch (Exception ex) {
                log.error("Expiring job {} failed: {}", jobId, ex.toString());
            }
        }
        return handled;
    }

    void redispatchIdleJobs(Set<UUID> skip) {
        List<UUID> candidates = jobRepository.findIdsByStatusInAndUpdatedAtBefore(OPEN,
                Instant.now().minus(idleThreshold));
        if (candidates.isEmpty()) {
            return;
        }
        Set<UUID> handsOff = new HashSet<>(stageRepository.findJobIdsWithStageStatusIn(HANDS_OFF));
        int dispatched = 0;
        for (UUID jobId : candidates) {
            if (skip.contains(jobId) || handsOff.contains(jobId)) {
                continue;
            }
            try {
                dispatcher.dispatchNext(jobId);
                dispatched++;
            } catch (Exception ex) {
                log.error("Re-dispatch of idle job {} failed: {}", jobId, ex.toString());
            }
        }
        if (dispatched > 0) {
            log.debug("Job reconciler re-evaluated {} idle job(s)", dispatched);
        }
    }
}
