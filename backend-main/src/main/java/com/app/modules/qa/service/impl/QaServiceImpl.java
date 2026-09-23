package com.app.modules.qa.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.pipeline.MediaPipelineDispatcher;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.qa.entity.QaIssue;
import com.app.modules.qa.entity.QaIssueOverride;
import com.app.modules.qa.repository.QaIssueOverrideRepository;
import com.app.modules.qa.repository.QaIssueRepository;
import com.app.modules.qa.service.QaService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class QaServiceImpl implements QaService {

    // Database_Design.md §8.3 example — technically severe issue types that can never be overridden,
    // not even by Lead. Only the one example given in the docs; extend here if BA names more.
    private static final Set<String> NEVER_OVERRIDABLE_TYPES = Set.of("subtitle_overlap");

    private final QaIssueRepository qaIssueRepository;
    private final QaIssueOverrideRepository qaIssueOverrideRepository;
    private final MediaJobService mediaJobService;
    private final MediaPipelineDispatcher mediaPipelineDispatcher;

    @Autowired
    public QaServiceImpl(QaIssueRepository qaIssueRepository,
                          QaIssueOverrideRepository qaIssueOverrideRepository,
                          MediaJobService mediaJobService,
                          MediaPipelineDispatcher mediaPipelineDispatcher) {
        this.qaIssueRepository = qaIssueRepository;
        this.qaIssueOverrideRepository = qaIssueOverrideRepository;
        this.mediaJobService = mediaJobService;
        this.mediaPipelineDispatcher = mediaPipelineDispatcher;
    }

    /** Compatibility constructor for focused unit tests that do not exercise pipeline resumption. */
    public QaServiceImpl(QaIssueRepository qaIssueRepository,
                         QaIssueOverrideRepository qaIssueOverrideRepository,
                         MediaJobService mediaJobService) {
        this(qaIssueRepository, qaIssueOverrideRepository, mediaJobService, null);
    }

    @Override
    @Transactional(readOnly = true)
    public List<QaIssue> listIssues(UUID workspaceId, UUID userId, UUID jobId, Boolean resolved) {
        List<UUID> segmentIds = mediaJobService.listSubtitles(workspaceId, userId, jobId).stream()
                .map(SubtitleSegment::getId)
                .toList();
        if (segmentIds.isEmpty()) {
            return List.of();
        }
        if (resolved == null) {
            return qaIssueRepository.findBySubtitleSegmentIdIn(segmentIds);
        }
        return resolved
                ? qaIssueRepository.findBySubtitleSegmentIdInAndResolvedAtIsNotNull(segmentIds)
                : qaIssueRepository.findBySubtitleSegmentIdInAndResolvedAtIsNull(segmentIds);
    }

    @Override
    @Transactional
    public QaIssueOverride overrideIssue(UUID workspaceId, UUID userId, UUID issueId, String reason) {
        QaIssue issue = qaIssueRepository.findById(issueId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        if (NEVER_OVERRIDABLE_TYPES.contains(issue.getIssueType()) && issue.getSeverity() == QaIssue.Severity.CRITICAL) {
            throw new AppException(ErrorCode.OVERRIDE_NOT_ALLOWED);
        }

        SubtitleSegment segment = mediaJobService.findSubtitleSegmentById(issue.getSubtitleSegmentId())
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        MediaJob job = mediaJobService.getJob(workspaceId, userId, segment.getMediaJobId());
        mediaJobService.requireJobOwnership(workspaceId, userId, job);

        if (reason == null || reason.trim().length() < 10) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        QaIssueOverride override = new QaIssueOverride();
        override.setQaIssueId(issueId);
        override.setOverriddenBy(userId);
        override.setReason(reason);
        override.setCreatedAt(Instant.now());
        override = qaIssueOverrideRepository.save(override);

        // An accepted override lifts the block for this issue going forward (§8.3: "override" is the
        // resolution path when there's no automatic fix) — resolved_at marks it so gates re-check clean.
        issue.setResolvedAt(Instant.now());
        qaIssueRepository.save(issue);

        if (mediaPipelineDispatcher != null) {
            mediaPipelineDispatcher.dispatchNext(segment.getMediaJobId());
        }

        return override;
    }

    @Override
    @Transactional
    public QaIssue recordIssue(UUID subtitleSegmentId, String issueType, QaIssue.Severity severity,
                                List<String> blockingActions, String detailJson) {
        QaIssue issue = new QaIssue();
        issue.setSubtitleSegmentId(subtitleSegmentId);
        issue.setIssueType(issueType);
        issue.setSeverity(severity);
        issue.setBlockingActions(blockingActions);
        issue.setDetail(detailJson);
        issue.setCreatedAt(Instant.now());
        return qaIssueRepository.save(issue);
    }
}
