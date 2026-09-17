package com.app.modules.preset.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.Size;

/**
 * Request body for updating an existing media preset (API_Contract.md §9).
 * Partial update: non-null fields will be updated.
 */
public record UpdateMediaPresetRequest(
        @Size(max = 200, message = "name must not exceed 200 characters")
        String name,

        JsonNode subtitleStyle,

        JsonNode voiceConfig,

        JsonNode renderConfig,

        Boolean isDefault,

        Boolean active
) {
}
