package com.app.modules.platform.dto;

import java.time.Instant;
import java.util.UUID;

/** Directory workspace row — metadata only. */
public record PlatformWorkspaceItem(
        UUID id,
        String name,
        String slug,
        UUID ownerUserId,
        String ownerEmail,
        long memberCount,
        Instant createdAt
) {}
