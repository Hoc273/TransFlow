package com.app.modules.project.dto;

import com.app.modules.project.entity.Project;

import java.time.Instant;
import java.util.UUID;

public record ProjectResponse(
        UUID id,
        UUID workspaceId,
        String name,
        String sourceLang,
        UUID defaultGlossaryId,
        Boolean tmEnabled,
        String domain,
        String tone,
        Instant createdAt,
        Instant updatedAt
) {
    public ProjectResponse(UUID id, UUID workspaceId, String name, String sourceLang, Instant createdAt, Instant updatedAt) {
        this(id, workspaceId, name, sourceLang, null, true, null, null, createdAt, updatedAt);
    }

    public static ProjectResponse from(Project p) {
        return new ProjectResponse(
                p.getId(),
                p.getWorkspaceId(),
                p.getName(),
                p.getSourceLang(),
                p.getDefaultGlossaryId(),
                p.getTmEnabled(),
                p.getDomain(),
                p.getTone(),
                p.getCreatedAt(),
                p.getUpdatedAt()
        );
    }
}
