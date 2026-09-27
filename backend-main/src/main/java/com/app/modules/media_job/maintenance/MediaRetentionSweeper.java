package com.app.modules.media_job.maintenance;

import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Storage retention: every object of the media bucket (source videos, extracted audio,
 * stems, TTS clips, mixes, renders, previews) is deleted once it is older than the
 * retention window (default 3 days). Asset rows stay for job history and get
 * {@code purged_at}; open jobs on a purged source are failed by {@link MediaJobReconciler}.
 *
 * <p>Files of a job that is running right now are kept until the next sweep, so a
 * stage never loses its input mid-flight.
 */
@Component
public class MediaRetentionSweeper {

    private static final Logger log = LoggerFactory.getLogger(MediaRetentionSweeper.class);
    private static final int DELETE_BATCH = 1000;
    private static final List<MediaJobStage.StageStatus> RUNNING = List.of(
            MediaJobStage.StageStatus.PROCESSING, MediaJobStage.StageStatus.CANCEL_REQUESTED);

    private final MediaStorageService storage;
    private final MediaAssetRepository assetRepository;
    private final MediaJobRepository jobRepository;
    private final MediaJobStageRepository stageRepository;
    private final TransactionTemplate tx;
    private final boolean enabled;
    private final Duration retention;
    private final List<String> skipPrefixes;

    public MediaRetentionSweeper(MediaStorageService storage,
                                 MediaAssetRepository assetRepository,
                                 MediaJobRepository jobRepository,
                                 MediaJobStageRepository stageRepository,
                                 TransactionTemplate tx,
                                 @Value("${app.maintenance.enabled:true}") boolean enabled,
                                 @Value("${app.maintenance.media-retention:P3D}") Duration retention,
                                 @Value("${app.maintenance.retention-skip-prefixes:generated-assets/}") String skipPrefixes) {
        this.storage = storage;
        this.assetRepository = assetRepository;
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.tx = tx;
        this.enabled = enabled;
        this.retention = retention;
        this.skipPrefixes = Arrays.stream(skipPrefixes == null ? new String[0] : skipPrefixes.split(","))
                .map(String::trim).filter(p -> !p.isEmpty()).toList();
    }

    @Scheduled(cron = "${app.maintenance.media-retention-cron:0 15 * * * *}")
    public void sweep() {
        if (!enabled) {
            return;
        }
        try {
            Result result = sweepOnce(Instant.now());
            if (result.deletedObjects() > 0 || result.purgedAssets() > 0) {
                log.info("Media retention: deleted {} object(s) ({} MB), kept {} in use, marked {} asset(s) purged",
                        result.deletedObjects(), result.deletedBytes() / (1024 * 1024), result.keptInUse(),
                        result.purgedAssets());
            }
        } catch (Exception ex) {
            log.error("Media retention sweep failed: {}", ex.toString());
        }
    }

    Result sweepOnce(Instant now) {
        Instant cutoff = now.minus(retention);

        // Files of jobs running right now are protected until they finish.
        Set<UUID> runningJobs = new HashSet<>(stageRepository.findJobIdsWithStageStatusIn(RUNNING));
        Set<UUID> protectedAssets = runningJobs.isEmpty() ? Set.of()
                : new HashSet<>(jobRepository.findRootAssetIds(runningJobs));
        Set<String> protectedKeys = new HashSet<>();
        for (MediaAsset asset : assetRepository.findAllById(protectedAssets)) {
            protectedKeys.add(asset.getObjectStorageKey());
        }
        // Derived keys embed the job id (extracted/, dubbed/, mixed/, subtitles/) or a stage
        // correlation id (separation/<runId>/), so both identify files a running job still reads.
        List<String> runningMarkers = new ArrayList<>(runningJobs.stream().map(UUID::toString).toList());
        if (!runningJobs.isEmpty()) {
            stageRepository.findByMediaJobIdInOrderByStageOrder(runningJobs).stream()
                    .map(MediaJobStage::getWorkerId)
                    .filter(id -> id != null && !id.isBlank())
                    .forEach(runningMarkers::add);
        }

        List<String> doomed = new ArrayList<>();
        long bytes = 0L;
        int kept = 0;
        for (MediaStorageService.StoredObject object : storage.listMediaObjectsOlderThan(cutoff)) {
            String key = object.objectKey();
            if (skipPrefixes.stream().anyMatch(key::startsWith)) {
                continue;
            }
            if (protectedKeys.contains(key) || runningMarkers.stream().anyMatch(key::contains)) {
                kept++;
                continue;
            }
            doomed.add(key);
            bytes += object.sizeBytes();
        }

        int deleted = 0;
        for (int from = 0; from < doomed.size(); from += DELETE_BATCH) {
            deleted += storage.removeMediaObjects(doomed.subList(from, Math.min(doomed.size(), from + DELETE_BATCH)));
        }

        // JPQL "not in ()" is invalid: an unused UUID stands in for an empty protected set.
        List<UUID> exclusions = protectedAssets.isEmpty() ? List.of(new UUID(0L, 0L)) : List.copyOf(protectedAssets);
        Integer purged = tx.execute(status -> assetRepository.markPurged(cutoff, now, exclusions));
        return new Result(deleted, bytes, kept, purged == null ? 0 : purged);
    }

    record Result(int deletedObjects, long deletedBytes, int keptInUse, int purgedAssets) {
    }
}
