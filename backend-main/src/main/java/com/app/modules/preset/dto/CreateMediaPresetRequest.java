package com.app.modules.preset.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * Request body for creating a media preset via workspace API (API_Contract.md §9).
 * Note: SYSTEM presets cannot be created via the workspace API.
 */
public record CreateMediaPresetRequest(
        @NotBlank(message = "scope is required")
        @Pattern(regexp = "WORKSPACE|PROJECT", message = "scope must be WORKSPACE or PROJECT")
        String scope,

        UUID projectId,

        @NotBlank(message = "name is required")
        @Size(max = 200, message = "name must not exceed 200 characters")
        String name,

        @NotNull(message = "subtitleStyle is required")
        JsonNode subtitleStyle,

        JsonNode voiceConfig,

        JsonNode renderConfig,

        Boolean isDefault
) {
}
