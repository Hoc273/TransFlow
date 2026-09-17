package com.app.modules.project.dto;

import com.app.modules.project.entity.Project;

import java.time.Instant;
import java.util.UUID;

public record ProjectResponse(
        UUID id,
        UUID workspaceId,
        String name,
        String sourceLang,
        Instant createdAt,
        Instant updatedAt
) {
    public static ProjectResponse from(Project p) {
        return new ProjectResponse(
                p.getId(),
                p.getWorkspaceId(),
                p.getName(),
                p.getSourceLang(),
                p.getCreatedAt(),
                p.getUpdatedAt()
        );
    }
}
