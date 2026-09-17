package com.app.modules.project.dto;

import com.app.modules.workspace.entity.Role;

import java.time.Instant;
import java.util.UUID;

public record ProjectMemberResponse(
        UUID id,
        UUID projectId,
        UUID userId,
        String email,
        String fullName,
        Role role,
        UUID addedBy,
        Instant createdAt
) {
}
