package com.app.modules.media_job.pipeline;

import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.notification.service.NotificationService;
import com.app.modules.qa.entity.QaIssue;
import com.app.modules.qa.repository.QaIssueRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MediaPipelineDispatcherQaGateTest {

    @Mock private MediaJobRepository jobRepository;
    @Mock private MediaJobStageRepository stageRepository;
    @Mock private MediaStageMessagePublisher publisher;
    @Mock private SubtitleSegmentRepository subtitleSegmentRepository;
    @Mock private QaIssueRepository qaIssueRepository;
    @Mock private NotificationService notificationService;

    private final UUID jobId = UUID.randomUUID();
    private final UUID workspaceId = UUID.randomUUID();
    private final UUID ownerId = UUID.randomUUID();
    private MediaJob job;
    private MediaJobStage tts;
    private MediaJobStage render;
    private MediaPipelineDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        job = new MediaJob();
        job.setId(jobId);
        job.setWorkspaceId(workspaceId);
        job.setCreatedByUserId(ownerId);
        job.setStatus(MediaJob.JobStatus.PROCESSING);
        job.setWorkflowMode(MediaJob.WorkflowMode.AUTO);
        tts = stage(MediaJobStage.StageName.TTS, 1, MediaJobStage.StageStatus.COMPLETED);
        render = stage(MediaJobStage.StageName.RENDER, 2, MediaJobStage.StageStatus.PENDING);
        when(jobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        when(stageRepository.findByMediaJobIdOrderByStageOrder(jobId)).thenReturn(List.of(tts, render));
        SubtitleSegment segment = new SubtitleSegment();
        segment.setId(UUID.randomUUID());
        when(subtitleSegmentRepository.findByMediaJobIdOrderBySeq(jobId)).thenReturn(List.of(segment));
        dispatcher = new MediaPipelineDispatcher(jobRepository, stageRepository, publisher,
                RestClient.builder().build(), subtitleSegmentRepository, qaIssueRepository,
                notificationService, true);
    }

    @Test
    void blockingQaIssueKeepsRenderPendingButMarksItAndNotifiesOnce() {
        when(qaIssueRepository.findBySubtitleSegmentIdInAndResolvedAtIsNull(anyList()))
                .thenReturn(List.of(issue("BLOCK_RENDER"), issue("BLOCK_PUBLISH")));

        dispatcher.dispatchNext(jobId);
        dispatcher.dispatchNext(jobId);

        assertEquals(MediaJobStage.StageStatus.PENDING, render.getStatus());
        assertEquals(MediaPipelineDispatcher.QA_BLOCKED, render.getErrorCode());
        assertTrue(render.getErrorMessage().contains("1 issue blocks rendering"));
        verify(publisher, never()).publish(any());
        verify(notificationService, times(1)).notify(eq(workspaceId), eq(ownerId), eq("JOB_QA_BLOCKED"),
                eq(jobId), any());
    }

    @Test
    void renderStartsAndClearsTheWaitOnceNoIssueBlocks() {
        render.setErrorCode(MediaPipelineDispatcher.QA_BLOCKED);
        render.setErrorMessage("Render is waiting for QA review: 1 issue blocks rendering");
        when(qaIssueRepository.findBySubtitleSegmentIdInAndResolvedAtIsNull(anyList()))
                .thenReturn(List.of(issue("BLOCK_PUBLISH")));

        dispatcher.dispatchNext(jobId);

        assertEquals(MediaJobStage.StageStatus.PROCESSING, render.getStatus());
        assertNull(render.getErrorCode());
        assertNull(render.getErrorMessage());
        verify(publisher).publish(any());
        verify(notificationService, never()).notify(any(), any(), any(), any(), any());
    }

    private MediaJobStage stage(MediaJobStage.StageName name, int order, MediaJobStage.StageStatus status) {
        MediaJobStage stage = new MediaJobStage();
        stage.setId(UUID.randomUUID());
        stage.setMediaJobId(jobId);
        stage.setStageName(name);
        stage.setStageOrder((short) order);
        stage.setStatus(status);
        return stage;
    }

    private QaIssue issue(String action) {
        QaIssue issue = new QaIssue();
        issue.setId(UUID.randomUUID());
        issue.setBlockingActions(List.of(action));
        return issue;
    }
}
