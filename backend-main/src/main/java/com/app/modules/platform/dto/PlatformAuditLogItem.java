package com.app.modules.platform.dto;

import java.time.Instant;
import java.util.UUID;

/** Audit log row for Super Admin self-read (API_Contract.md §13.1). */
public record PlatformAuditLogItem(
        UUID id,
        UUID actorUserId,
        String action,
        String httpMethod,
        String path,
        String queryString,
        String ip,
        String userAgent,
        int statusCode,
        Instant createdAt
) {}
