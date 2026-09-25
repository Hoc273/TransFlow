package com.app.modules.media_job.service.impl;

import com.app.modules.credit.service.CreditService;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_job.dto.PatchSubtitleRequest;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.pipeline.MediaPipelineDispatcher;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.notification.service.NotificationService;
import com.app.modules.preset.service.PresetResolverService;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.qa.entity.QaIssue;
import com.app.modules.qa.repository.QaIssueRepository;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Editing a cue is the fix path for its QA findings, so a fixed cue must stop blocking RENDER. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MediaJobServiceQaResolutionTest {

    @Mock private MediaJobRepository jobRepository;
    @Mock private MediaJobStageRepository stageRepository;
    @Mock private SubtitleSegmentRepository subtitleRepository;
    @Mock private WorkspaceAccessService access;
    @Mock private MediaAssetService mediaAssetService;
    @Mock private CreditService credit;
    @Mock private PresetResolverService presetResolver;
    @Mock private ProviderResolverService providerResolver;
    @Mock private NotificationService notification;
    @Mock private MediaPipelineDispatcher dispatcher;
    @Mock private QaIssueRepository qaIssueRepository;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();
    private MediaJobServiceImpl service;
    private SubtitleSegment first;
    private SubtitleSegment second;
    private MediaJobStage render;

    @BeforeEach
    void setUp() {
        service = new MediaJobServiceImpl(jobRepository, stageRepository, subtitleRepository, access,
                mediaAssetService, credit, presetResolver, providerResolver, notification, dispatcher,
                qaIssueRepository);
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setWorkspaceId(workspaceId);
        job.setCreatedByUserId(userId);
        when(jobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        when(access.getRole(workspaceId, userId)).thenReturn(Role.LEAD);
        first = segment(1, 0, 2_000);
        second = segment(2, 1_500, 4_000); // overlaps the first cue
        when(subtitleRepository.findByMediaJobIdOrderBySeq(jobId)).thenReturn(List.of(first, second));
        when(subtitleRepository.findByIdAndMediaJobId(any(), any())).thenAnswer(inv ->
                inv.getArgument(0).equals(first.getId()) ? Optional.of(first) : Optional.of(second));
        when(subtitleRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        render = new MediaJobStage();
        render.setStageName(MediaJobStage.StageName.RENDER);
        render.setStageOrder((short) 8);
        render.setStatus(MediaJobStage.StageStatus.PENDING);
        when(stageRepository.findByMediaJobIdOrderByStageOrder(jobId)).thenReturn(List.of(render));
    }

    @Test
    void textEditResolvesTheCueAiFindingAndReleasesTheWaitingRender() {
        QaIssue accuracy = issue(first, "accuracy");
        QaIssue otherCue = issue(second, "fluency");
        when(qaIssueRepository.findBySubtitleSegmentIdInAndResolvedAtIsNull(anyList()))
                .thenReturn(List.of(accuracy, otherCue));

        service.patchSubtitle(workspaceId, userId, jobId, first.getId(),
                new PatchSubtitleRequest("Corrected line", null, null));

        assertNotNull(accuracy.getResolvedAt());
        assertNull(otherCue.getResolvedAt());
        verify(dispatcher).dispatchNext(jobId);
    }

    @Test
    void timingIssueIsResolvedOnlyWhenTheOverlapIsGone() {
        QaIssue overlap = issue(second, "subtitle_overlap");
        QaIssue accuracy = issue(second, "accuracy");
        when(qaIssueRepository.findBySubtitleSegmentIdInAndResolvedAtIsNull(anyList()))
                .thenReturn(List.of(overlap, accuracy));

        service.patchSubtitle(workspaceId, userId, jobId, second.getId(),
                new PatchSubtitleRequest(null, 2_000L, null));

        assertNotNull(overlap.getResolvedAt());
        assertNull(accuracy.getResolvedAt()); // only timing changed: content findings still apply
    }

    @Test
    void staleDownstreamWorkIsNeverStartedAutomatically() {
        render.setStatus(MediaJobStage.StageStatus.STALE);
        QaIssue accuracy = issue(first, "accuracy");
        when(qaIssueRepository.findBySubtitleSegmentIdInAndResolvedAtIsNull(anyList()))
                .thenReturn(List.of(accuracy));

        service.patchSubtitle(workspaceId, userId, jobId, first.getId(),
                new PatchSubtitleRequest("Corrected line", null, null));

        assertNotNull(accuracy.getResolvedAt());
        verify(dispatcher, never()).dispatchNext(any());
    }

    private SubtitleSegment segment(int seq, long start, long end) {
        SubtitleSegment segment = new SubtitleSegment();
        segment.setId(UUID.randomUUID());
        segment.setMediaJobId(jobId);
        segment.setSeq(seq);
        segment.setTargetText("Line " + seq);
        segment.setStartMs(start);
        segment.setEndMs(end);
        return segment;
    }

    private QaIssue issue(SubtitleSegment segment, String type) {
        QaIssue issue = new QaIssue();
        issue.setId(UUID.randomUUID());
        issue.setSubtitleSegmentId(segment.getId());
        issue.setIssueType(type);
        return issue;
    }
}
