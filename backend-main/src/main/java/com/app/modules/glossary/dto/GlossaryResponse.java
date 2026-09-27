package com.app.modules.glossary.dto;

import com.app.modules.glossary.entity.Glossary;

import java.time.Instant;
import java.util.UUID;

public record GlossaryResponse(UUID id, UUID projectId, Instant createdAt) {
    public static GlossaryResponse from(Glossary g) {
        return new GlossaryResponse(g.getId(), g.getProjectId(), g.getCreatedAt());
    }
}
