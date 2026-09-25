package com.app.modules.batch.maintenance;

import com.app.modules.batch.entity.LocalizationBatch;
import com.app.modules.batch.repository.LocalizationBatchRepository;
import com.app.modules.batch.service.BatchService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Re-derives the status of open batches from their child jobs (Arch §6/§12). The status is
 * normally recomputed in the child job's own transaction; this sweep covers child jobs that
 * were closed by a path that bypasses the recompute (crash mid-callback, manual DB fixes).
 */
@Component
public class BatchStatusReconciler {

    private static final Logger log = LoggerFactory.getLogger(BatchStatusReconciler.class);
    private static final List<LocalizationBatch.BatchStatus> OPEN = List.of(
            LocalizationBatch.BatchStatus.PENDING, LocalizationBatch.BatchStatus.PROCESSING);

    private final LocalizationBatchRepository batchRepository;
    private final BatchService batchService;
    private final boolean enabled;

    public BatchStatusReconciler(LocalizationBatchRepository batchRepository,
                                 BatchService batchService,
                                 @Value("${app.maintenance.enabled:true}") boolean enabled) {
        this.batchRepository = batchRepository;
        this.batchService = batchService;
        this.enabled = enabled;
    }

    @Scheduled(fixedDelayString = "${app.maintenance.batch-reconciler-interval:PT10M}",
            initialDelayString = "${app.maintenance.initial-delay:PT2M}")
    public void sweep() {
        if (!enabled) {
            return;
        }
        for (UUID batchId : batchRepository.findIdsByStatusInAndCreatedAtBefore(OPEN, Instant.now().minusSeconds(300))) {
            try {
                batchService.recomputeStatus(batchId);
            } catch (Exception ex) {
                log.error("Batch status recompute failed batch={}: {}", batchId, ex.toString());
            }
        }
    }
}
