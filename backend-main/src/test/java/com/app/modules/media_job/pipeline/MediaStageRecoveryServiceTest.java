package com.app.modules.media_job.pipeline;

import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MediaStageRecoveryServiceTest {

    @Mock private MediaJobRepository jobRepository;
    @Mock private MediaJobStageRepository stageRepository;
    @Mock private MediaCallbackService callbackService;
    @Mock private MediaPipelineDispatcher dispatcher;

    private final UUID jobId = UUID.randomUUID();
    private final UUID stageId = UUID.randomUUID();
    private final Instant now = Instant.parse("2026-09-24T12:00:00Z");
    private MediaStageRecoveryService recovery;
    private MediaJob job;

    @BeforeEach
    void setUp() {
        job = new MediaJob();
        job.setId(jobId);
        job.setStatus(MediaJob.JobStatus.PROCESSING);
        when(jobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        recovery = new MediaStageRecoveryService(jobRepository, stageRepository, callbackService, dispatcher);
    }

    private MediaJobStage stage(MediaJobStage.StageName name, MediaJobStage.StageStatus status,
                                Duration age, int attempts) {
        MediaJobStage stage = new MediaJobStage();
        stage.setId(stageId);
        stage.setMediaJobId(jobId);
        stage.setStageName(name);
        stage.setStatus(status);
        stage.setWorkerId("old-correlation");
        stage.setAttemptCount((short) attempts);
        stage.setStartedAt(now.minus(age));
        when(stageRepository.findById(stageId)).thenReturn(Optional.of(stage));
        return stage;
    }

    @Test
    void overdueAttemptIsRedispatchedUnderANewAttempt() {
        MediaJobStage stage = stage(MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.PROCESSING,
                Duration.ofMinutes(16), 1);

        Optional<MediaStageRecoveryService.WorkerCancel> cancel = recovery.recover(jobId, stageId, now);

        assertEquals(MediaJobStage.StageStatus.PENDING, stage.getStatus());
        assertNull(stage.getWorkerId());
        verify(dispatcher).dispatchNext(jobId);
        verify(callbackService, never()).completeStage(any(), any(), any(), anyBoolean(), any(), any(), any(), any());
        assertTrue(cancel.isEmpty(), "extract-audio has no worker cancel endpoint");
    }

    @Test
    void overdueRenderIsCancelledAtTheWorkerBeforeRetrying() {
        stage(MediaJobStage.StageName.RENDER, MediaJobStage.StageStatus.PROCESSING, Duration.ofMinutes(46), 1);

        Optional<MediaStageRecoveryService.WorkerCancel> cancel = recovery.recover(jobId, stageId, now);

        verify(dispatcher).dispatchNext(jobId);
        assertEquals(Optional.of(new MediaStageRecoveryService.WorkerCancel(
                MediaJobStage.StageName.RENDER, "old-correlation")), cancel);
    }

    @Test
    void providerFailoverRequeuesTheCurrentAttempt() {
        MediaJobStage stage = stage(MediaJobStage.StageName.TRANSLATE, MediaJobStage.StageStatus.PROCESSING,
                Duration.ofMinutes(1), 1);

        assertTrue(recovery.retryOnAnotherProvider(jobId, stageId, "old-correlation", "PROVIDER_RATE_LIMITED"));

        assertEquals(MediaJobStage.StageStatus.PENDING, stage.getStatus());
        assertNull(stage.getWorkerId());
        assertTrue(stage.getErrorMessage().contains("PROVIDER_RATE_LIMITED"));
        verify(dispatcher).dispatchNext(jobId);
    }

    @Test
    void providerFailoverIgnoresASupersededAttempt() {
        MediaJobStage stage = stage(MediaJobStage.StageName.TRANSLATE, MediaJobStage.StageStatus.PROCESSING,
                Duration.ofMinutes(1), 2);

        assertFalse(recovery.retryOnAnotherProvider(jobId, stageId, "stale-correlation", "PROVIDER_RATE_LIMITED"));

        assertEquals(MediaJobStage.StageStatus.PROCESSING, stage.getStatus());
        verify(dispatcher, never()).dispatchNext(any());
    }

    @Test
    void attemptWithinItsTimeBudgetIsLeftAlone() {
        MediaJobStage stage = stage(MediaJobStage.StageName.RENDER, MediaJobStage.StageStatus.PROCESSING,
                Duration.ofMinutes(20), 1);

        assertTrue(recovery.recover(jobId, stageId, now).isEmpty());

        assertEquals(MediaJobStage.StageStatus.PROCESSING, stage.getStatus());
        verifyNoInteractions(dispatcher, callbackService);
    }

    @Test
    void overdueAttemptAfterTheLastRetryFailsTheStageWithATypedTimeout() {
        stage(MediaJobStage.StageName.STT, MediaJobStage.StageStatus.PROCESSING, Duration.ofMinutes(26), 3);

        recovery.recover(jobId, stageId, now);

        verify(dispatcher, never()).dispatchNext(any());
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.STT), eq(false),
                isNull(), anyString(), eq("STAGE_TIMEOUT"),
                argThat(detail -> "STAGE_TIMEOUT".equals(detail.path("errorCode").asText())));
    }

    @Test
    void cancelWhoseWorkerNeverAnsweredIsFinalizedAsCancelled() {
        stage(MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.CANCEL_REQUESTED,
                Duration.ofMinutes(16), 1);

        recovery.recover(jobId, stageId, now);

        verify(callbackService).completeStage(jobId, stageId, MediaJobStage.StageName.EXTRACT_AUDIO,
                false, null, null);
        verify(dispatcher, never()).dispatchNext(any());
    }

    @Test
    void stageThatFinishedWhileWaitingForTheLockIsNotTouched() {
        MediaJobStage stage = stage(MediaJobStage.StageName.TTS, MediaJobStage.StageStatus.COMPLETED,
                Duration.ofHours(2), 1);

        assertTrue(recovery.recover(jobId, stageId, now).isEmpty());

        assertEquals(MediaJobStage.StageStatus.COMPLETED, stage.getStatus());
        verifyNoInteractions(dispatcher, callbackService);
    }
}
