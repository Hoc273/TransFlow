package com.app.modules.preset.dto;

import com.app.modules.preset.entity.MediaPreset;
import com.app.modules.preset.entity.MediaPresetScope;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record MediaPresetResponse(
        UUID id,
        MediaPresetScope scope,
        UUID workspaceId,
        UUID projectId,
        String name,
        JsonNode subtitleStyle,
        JsonNode voiceConfig,
        JsonNode renderConfig,
        boolean isDefault,
        boolean active,
        UUID createdBy,
        UUID updatedBy,
        Instant createdAt,
        Instant updatedAt
) {
    public static MediaPresetResponse from(MediaPreset preset) {
        return new MediaPresetResponse(
                preset.getId(),
                preset.getScope(),
                preset.getWorkspaceId(),
                preset.getProjectId(),
                preset.getName(),
                preset.getSubtitleStyle(),
                preset.getVoiceConfig(),
                preset.getRenderConfig(),
                preset.isDefault(),
                preset.isActive(),
                preset.getCreatedBy(),
                preset.getUpdatedBy(),
                preset.getCreatedAt(),
                preset.getUpdatedAt()
        );
    }
}
