package com.app.modules.platform.dto;

import java.time.Instant;
import java.util.UUID;

/** Row of GET /api/platform/activity-logs. */
public record UserActivityLogItem(
        UUID id,
        UUID userId,
        String userEmail,
        UUID workspaceId,
        String action,
        String httpMethod,
        String path,
        String ip,
        String userAgent,
        int statusCode,
        Instant createdAt
) {}
