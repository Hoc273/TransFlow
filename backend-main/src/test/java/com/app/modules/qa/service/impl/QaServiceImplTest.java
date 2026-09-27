package com.app.modules.qa.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.qa.entity.QaIssue;
import com.app.modules.qa.entity.QaIssueOverride;
import com.app.modules.qa.repository.QaIssueOverrideRepository;
import com.app.modules.qa.repository.QaIssueRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class QaServiceImplTest {

    @Mock private QaIssueRepository qaIssueRepository;
    @Mock private QaIssueOverrideRepository qaIssueOverrideRepository;
    @Mock private MediaJobService mediaJobService;

    private QaServiceImpl service;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new QaServiceImpl(qaIssueRepository, qaIssueOverrideRepository, mediaJobService);
    }

    private SubtitleSegment segment(UUID id) {
        SubtitleSegment s = new SubtitleSegment();
        s.setId(id);
        s.setMediaJobId(jobId);
        return s;
    }

    // ---- listIssues ----

    @Test
    void listIssues_noSegments_returnsEmptyWithoutQuerying() {
        when(mediaJobService.listSubtitles(workspaceId, userId, jobId)).thenReturn(List.of());

        List<QaIssue> result = service.listIssues(workspaceId, userId, jobId, null);

        assertTrue(result.isEmpty());
        verifyNoInteractions(qaIssueRepository);
    }

    @Test
    void listIssues_unresolvedFilter_callsCorrectRepositoryMethod() {
        UUID segId = UUID.randomUUID();
        when(mediaJobService.listSubtitles(workspaceId, userId, jobId)).thenReturn(List.of(segment(segId)));
        when(qaIssueRepository.findBySubtitleSegmentIdInAndResolvedAtIsNull(List.of(segId))).thenReturn(List.of(new QaIssue()));

        List<QaIssue> result = service.listIssues(workspaceId, userId, jobId, false);

        assertEquals(1, result.size());
        verify(qaIssueRepository, never()).findBySubtitleSegmentIdIn(any());
    }

    @Test
    void listIssues_nullFilter_returnsAll() {
        UUID segId = UUID.randomUUID();
        when(mediaJobService.listSubtitles(workspaceId, userId, jobId)).thenReturn(List.of(segment(segId)));
        when(qaIssueRepository.findBySubtitleSegmentIdIn(List.of(segId))).thenReturn(List.of(new QaIssue(), new QaIssue()));

        List<QaIssue> result = service.listIssues(workspaceId, userId, jobId, null);

        assertEquals(2, result.size());
    }

    // ---- overrideIssue ----

    private QaIssue issue(UUID id, String type, QaIssue.Severity severity, UUID segmentId) {
        QaIssue issue = new QaIssue();
        issue.setId(id);
        issue.setIssueType(type);
        issue.setSeverity(severity);
        issue.setSubtitleSegmentId(segmentId);
        return issue;
    }

    @Test
    void overrideIssue_neverOverridableCriticalType_throwsOverrideNotAllowed() {
        UUID issueId = UUID.randomUUID();
        QaIssue issue = issue(issueId, "subtitle_overlap", QaIssue.Severity.CRITICAL, UUID.randomUUID());
        when(qaIssueRepository.findById(issueId)).thenReturn(Optional.of(issue));

        AppException ex = assertThrows(AppException.class, () ->
                service.overrideIssue(workspaceId, userId, issueId, "a valid reason"));
        assertEquals(ErrorCode.OVERRIDE_NOT_ALLOWED, ex.getErrorCode());
        verifyNoInteractions(mediaJobService, qaIssueOverrideRepository);
    }

    @Test
    void overrideIssue_sameTypeButNotCritical_isAllowedPastTheTypeGuard() {
        UUID issueId = UUID.randomUUID();
        UUID segId = UUID.randomUUID();
        QaIssue issue = issue(issueId, "subtitle_overlap", QaIssue.Severity.LOW, segId);
        when(qaIssueRepository.findById(issueId)).thenReturn(Optional.of(issue));
        when(mediaJobService.findSubtitleSegmentById(segId)).thenReturn(Optional.of(segment(segId)));
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setProjectId(projectId);
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(job);
        when(qaIssueOverrideRepository.save(any(QaIssueOverride.class))).thenAnswer(inv -> inv.getArgument(0));

        assertDoesNotThrow(() -> service.overrideIssue(workspaceId, userId, issueId, "a valid reason"));
        verify(mediaJobService).requireJobOwnership(workspaceId, userId, job);
    }

    @Test
    void overrideIssue_notJobOwner_propagatesJobOwnershipRequired() {
        UUID issueId = UUID.randomUUID();
        UUID segId = UUID.randomUUID();
        QaIssue issue = issue(issueId, "translation_mismatch", QaIssue.Severity.HIGH, segId);
        when(qaIssueRepository.findById(issueId)).thenReturn(Optional.of(issue));
        when(mediaJobService.findSubtitleSegmentById(segId)).thenReturn(Optional.of(segment(segId)));
        MediaJob job = new MediaJob();
        job.setId(jobId);
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(job);
        doThrow(new AppException(ErrorCode.JOB_OWNERSHIP_REQUIRED))
                .when(mediaJobService).requireJobOwnership(workspaceId, userId, job);

        AppException ex = assertThrows(AppException.class, () ->
                service.overrideIssue(workspaceId, userId, issueId, "a valid reason"));
        assertEquals(ErrorCode.JOB_OWNERSHIP_REQUIRED, ex.getErrorCode());
        verifyNoInteractions(qaIssueOverrideRepository);
    }

    @Test
    void overrideIssue_reasonTooShort_throwsValidationError() {
        UUID issueId = UUID.randomUUID();
        UUID segId = UUID.randomUUID();
        QaIssue issue = issue(issueId, "translation_mismatch", QaIssue.Severity.MEDIUM, segId);
        when(qaIssueRepository.findById(issueId)).thenReturn(Optional.of(issue));
        when(mediaJobService.findSubtitleSegmentById(segId)).thenReturn(Optional.of(segment(segId)));
        MediaJob job = new MediaJob();
        job.setId(jobId);
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(job);

        AppException ex = assertThrows(AppException.class, () ->
                service.overrideIssue(workspaceId, userId, issueId, "short"));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
        verifyNoInteractions(qaIssueOverrideRepository);
    }

    @Test
    void overrideIssue_success_savesOverrideAndResolvesIssue() {
        UUID issueId = UUID.randomUUID();
        UUID segId = UUID.randomUUID();
        QaIssue issue = issue(issueId, "translation_mismatch", QaIssue.Severity.HIGH, segId);
        when(qaIssueRepository.findById(issueId)).thenReturn(Optional.of(issue));
        when(mediaJobService.findSubtitleSegmentById(segId)).thenReturn(Optional.of(segment(segId)));
        MediaJob job = new MediaJob();
        job.setId(jobId);
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(job);
        when(qaIssueOverrideRepository.save(any(QaIssueOverride.class))).thenAnswer(inv -> inv.getArgument(0));

        QaIssueOverride result = service.overrideIssue(workspaceId, userId, issueId, "context: acceptable risk");

        assertEquals(issueId, result.getQaIssueId());
        assertEquals(userId, result.getOverriddenBy());
        assertEquals("context: acceptable risk", result.getReason());
        assertNotNull(result.getCreatedAt());
        assertNotNull(issue.getResolvedAt());
        verify(qaIssueRepository).save(issue);
    }

    @Test
    void overrideIssue_issueNotFound_throwsResourceNotFound() {
        UUID issueId = UUID.randomUUID();
        when(qaIssueRepository.findById(issueId)).thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class, () ->
                service.overrideIssue(workspaceId, userId, issueId, "a valid reason"));
        assertEquals(ErrorCode.RESOURCE_NOT_FOUND, ex.getErrorCode());
    }

    // ---- recordIssue ----

    @Test
    void recordIssue_persistsAllFields() {
        UUID segId = UUID.randomUUID();
        when(qaIssueRepository.save(any(QaIssue.class))).thenAnswer(inv -> inv.getArgument(0));

        QaIssue result = service.recordIssue(segId, "subtitle_overlap", QaIssue.Severity.CRITICAL,
                List.of("BLOCK_PUBLISH", "BLOCK_RENDER"), "{\"overlapMs\":120}");

        assertEquals(segId, result.getSubtitleSegmentId());
        assertEquals("subtitle_overlap", result.getIssueType());
        assertEquals(QaIssue.Severity.CRITICAL, result.getSeverity());
        assertEquals(List.of("BLOCK_PUBLISH", "BLOCK_RENDER"), result.getBlockingActions());
        assertNotNull(result.getCreatedAt());
    }
}
