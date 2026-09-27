package com.app.modules.qa.dto;

import com.app.modules.qa.entity.QaIssueOverride;

import java.time.Instant;
import java.util.UUID;

public record QaIssueOverrideResponse(UUID id, UUID qaIssueId, UUID overriddenBy, String reason, Instant createdAt) {
    public static QaIssueOverrideResponse from(QaIssueOverride o) {
        return new QaIssueOverrideResponse(o.getId(), o.getQaIssueId(), o.getOverriddenBy(), o.getReason(), o.getCreatedAt());
    }
}
