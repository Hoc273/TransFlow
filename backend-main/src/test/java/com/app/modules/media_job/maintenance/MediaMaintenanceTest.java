package com.app.modules.media_job.maintenance;

import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.pipeline.MediaPipelineDispatcher;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** Retention sweep, idle-job reconciler and expiry of jobs whose source was purged. */
@ExtendWith(MockitoExtension.class)
class MediaMaintenanceTest {

    @Mock
    private MediaStorageService storage;
    @Mock
    private MediaAssetRepository assetRepository;
    @Mock
    private MediaJobRepository jobRepository;
    @Mock
    private MediaJobStageRepository stageRepository;
    @Mock
    private TransactionTemplate tx;
    @Mock
    private MediaPipelineDispatcher dispatcher;
    @Mock
    private MediaJobExpiryService expiryService;
    @Mock
    private MediaCallbackService callbackService;

    private static final Instant NOW = Instant.parse("2026-09-25T10:00:00Z");

    private MediaRetentionSweeper sweeper() {
        return new MediaRetentionSweeper(storage, assetRepository, jobRepository, stageRepository, tx,
                true, Duration.ofDays(3), "generated-assets/");
    }

    @SuppressWarnings("unchecked")
    private void runTransactions() {
        when(tx.execute(any())).thenAnswer(inv -> ((TransactionCallback<Integer>) inv.getArgument(0)).doInTransaction(null));
    }

    @Test
    void retentionDeletesOldObjectsButKeepsRunningJobFilesAndSkippedPrefixes() {
        runTransactions();
        UUID runningJob = UUID.randomUUID();
        UUID runningAsset = UUID.randomUUID();
        MediaAsset source = new MediaAsset();
        source.setId(runningAsset);
        source.setObjectStorageKey("source/running");
        MediaJobStage separation = new MediaJobStage();
        separation.setMediaJobId(runningJob);
        separation.setWorkerId("corr-1");

        when(stageRepository.findJobIdsWithStageStatusIn(any())).thenReturn(List.of(runningJob));
        when(jobRepository.findRootAssetIds(Set.of(runningJob))).thenReturn(List.of(runningAsset));
        when(assetRepository.findAllById(Set.of(runningAsset))).thenReturn(List.of(source));
        when(stageRepository.findByMediaJobIdInOrderByStageOrder(Set.of(runningJob))).thenReturn(List.of(separation));
        Instant old = NOW.minus(Duration.ofDays(4));
        when(storage.listMediaObjectsOlderThan(NOW.minus(Duration.ofDays(3)))).thenReturn(List.of(
                new MediaStorageService.StoredObject("source/old", old, 10),
                new MediaStorageService.StoredObject("source/running", old, 10),
                new MediaStorageService.StoredObject("extracted/" + runningJob + "/a.wav", old, 10),
                new MediaStorageService.StoredObject("separation/corr-1/vocals", old, 10),
                new MediaStorageService.StoredObject("generated-assets/v1/x", old, 10),
                new MediaStorageService.StoredObject("dubbed/other/b.mp3", old, 5)));
        when(storage.removeMediaObjects(any())).thenAnswer(inv -> ((Collection<?>) inv.getArgument(0)).size());
        when(assetRepository.markPurged(any(), any(), anyCollection())).thenReturn(1);

        MediaRetentionSweeper.Result result = sweeper().sweepOnce(NOW);

        ArgumentCaptor<Collection<String>> deleted = ArgumentCaptor.forClass(Collection.class);
        verify(storage).removeMediaObjects(deleted.capture());
        assertEquals(List.of("source/old", "dubbed/other/b.mp3"), List.copyOf(deleted.getValue()));
        assertEquals(2, result.deletedObjects());
        assertEquals(3, result.keptInUse());
        verify(assetRepository).markPurged(NOW.minus(Duration.ofDays(3)), NOW, List.of(runningAsset));
    }

    @Test
    void retentionWithNothingRunningUsesPlaceholderExclusion() {
        runTransactions();
        when(stageRepository.findJobIdsWithStageStatusIn(any())).thenReturn(List.of());
        when(assetRepository.findAllById(Set.of())).thenReturn(List.of());
        when(storage.listMediaObjectsOlderThan(any())).thenReturn(List.of());

        sweeper().sweepOnce(NOW);

        verify(storage, never()).removeMediaObjects(any());
        verify(assetRepository).markPurged(any(), eq(NOW), eq(List.of(new UUID(0L, 0L))));
    }

    @Test
    void reconcilerRedispatchesIdleJobsOnly() {
        UUID idle = UUID.randomUUID();
        UUID running = UUID.randomUUID();
        UUID stale = UUID.randomUUID();
        UUID expired = UUID.randomUUID();
        when(jobRepository.findIdsWithPurgedRootAsset(any())).thenReturn(List.of(expired));
        when(expiryService.expire(expired)).thenReturn(true);
        when(jobRepository.findIdsByStatusInAndUpdatedAtBefore(any(), any()))
                .thenReturn(List.of(idle, running, stale, expired));
        when(stageRepository.findJobIdsWithStageStatusIn(any())).thenReturn(List.of(running, stale));

        new MediaJobReconciler(jobRepository, stageRepository, dispatcher, expiryService, true, true,
                Duration.ofMinutes(5)).sweep();

        verify(dispatcher).dispatchNext(idle);
        verify(dispatcher, never()).dispatchNext(running);
        verify(dispatcher, never()).dispatchNext(stale);
        verify(dispatcher, never()).dispatchNext(expired);
    }

    @Test
    void reconcilerDoesNothingWhenPipelineDisabled() {
        new MediaJobReconciler(jobRepository, stageRepository, dispatcher, expiryService, false, true,
                Duration.ofMinutes(5)).sweep();
        verifyNoInteractions(jobRepository, dispatcher, expiryService);
    }

    @Test
    void expiryFailsFirstPendingStageWithMediaFileExpired() {
        UUID jobId = UUID.randomUUID();
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setStatus(MediaJob.JobStatus.PROCESSING);
        MediaJobStage done = stage(jobId, MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.COMPLETED);
        MediaJobStage next = stage(jobId, MediaJobStage.StageName.STT, MediaJobStage.StageStatus.PENDING);
        when(jobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        when(stageRepository.findByMediaJobIdOrderByStageOrder(jobId)).thenReturn(List.of(done, next));

        assertTrue(new MediaJobExpiryService(jobRepository, stageRepository, callbackService).expire(jobId));

        verify(callbackService).completeStage(eq(jobId), eq(next.getId()), eq(MediaJobStage.StageName.STT),
                eq(false), eq(null), any(), eq(MediaJobExpiryService.MEDIA_FILE_EXPIRED), any());
    }

    @Test
    void expiryLeavesRunningJobsAlone() {
        UUID jobId = UUID.randomUUID();
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setStatus(MediaJob.JobStatus.PROCESSING);
        when(jobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        when(stageRepository.findByMediaJobIdOrderByStageOrder(jobId)).thenReturn(List.of(
                stage(jobId, MediaJobStage.StageName.STT, MediaJobStage.StageStatus.PROCESSING)));

        assertFalse(new MediaJobExpiryService(jobRepository, stageRepository, callbackService).expire(jobId));
        verifyNoInteractions(callbackService);
    }

    private static MediaJobStage stage(UUID jobId, MediaJobStage.StageName name, MediaJobStage.StageStatus status) {
        MediaJobStage s = new MediaJobStage();
        s.setId(UUID.randomUUID());
        s.setMediaJobId(jobId);
        s.setStageName(name);
        s.setStatus(status);
        return s;
    }
}
