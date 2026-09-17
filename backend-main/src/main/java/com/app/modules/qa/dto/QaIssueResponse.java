package com.app.modules.qa.dto;

import com.app.modules.qa.entity.QaIssue;
import com.fasterxml.jackson.annotation.JsonRawValue;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record QaIssueResponse(
        UUID id,
        UUID subtitleSegmentId,
        String issueType,
        String severity,
        List<String> blockingActions,
        @JsonRawValue String detail,
        Instant resolvedAt,
        Instant createdAt
) {
    public static QaIssueResponse from(QaIssue issue) {
        return new QaIssueResponse(issue.getId(), issue.getSubtitleSegmentId(), issue.getIssueType(),
                issue.getSeverity().name(), issue.getBlockingActions(), issue.getDetail(),
                issue.getResolvedAt(), issue.getCreatedAt());
    }
}
