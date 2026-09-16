package com.app.modules.workspace.dto;

import com.app.modules.workspace.entity.Role;

import java.time.Instant;
import java.util.UUID;

public record WorkspaceMemberResponse(
        UUID memberId,
        UUID userId,
        String email,
        String fullName,
        Role role,
        Instant createdAt
) {
}
