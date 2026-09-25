package com.app.modules.media_job.pipeline;

import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.util.List;

/**
 * Periodic stuck-stage sweep. Each candidate is recovered in its own transaction;
 * worker cancels are sent only after that transaction commits, so no HTTP call is
 * made while the job row is locked.
 */
@Component
public class MediaStageWatchdog {

    private static final Logger log = LoggerFactory.getLogger(MediaStageWatchdog.class);

    private final MediaJobStageRepository stageRepository;
    private final MediaStageRecoveryService recovery;
    private final RestClient workerClient;
    private final boolean enabled;

    public MediaStageWatchdog(MediaJobStageRepository stageRepository,
                              MediaStageRecoveryService recovery,
                              @Qualifier("mediaWorkerRestClient") RestClient workerClient,
                              @Value("${app.pipeline.enabled:true}") boolean enabled) {
        this.stageRepository = stageRepository;
        this.recovery = recovery;
        this.workerClient = workerClient;
        this.enabled = enabled;
    }

    @Scheduled(fixedDelayString = "${app.pipeline.watchdog-interval:PT1M}",
            initialDelayString = "${app.pipeline.watchdog-interval:PT1M}")
    public void sweep() {
        if (!enabled) {
            return;
        }
        Instant now = Instant.now();
        List<MediaJobStage> candidates = stageRepository.findByStatusInAndStartedAtBefore(
                List.of(MediaJobStage.StageStatus.PROCESSING, MediaJobStage.StageStatus.CANCEL_REQUESTED),
                now.minus(MediaStageRecoveryService.SHORTEST_BUDGET));
        for (MediaJobStage candidate : candidates) {
            try {
                recovery.recover(candidate.getMediaJobId(), candidate.getId(), now).ifPresent(this::cancelAtWorker);
            } catch (Exception ex) {
                log.error("Stuck-stage recovery failed job={} stage={}: {}",
                        candidate.getMediaJobId(), candidate.getStageName(), ex.toString());
            }
        }
    }

    private void cancelAtWorker(MediaStageRecoveryService.WorkerCancel cancel) {
        String path = cancel.stageName() == MediaJobStage.StageName.AUDIO_MIX
                ? "/internal/media/audio-mix/" : "/internal/media/render/";
        try {
            workerClient.post().uri(path + cancel.correlationId() + "/cancel").retrieve().toBodilessEntity();
        } catch (Exception ex) {
            // Its late result is ignored anyway (superseded correlation).
            log.warn("Worker cancel of superseded {} attempt failed correlation={}: {}",
                    cancel.stageName(), cancel.correlationId(), ex.getMessage());
        }
    }
}
