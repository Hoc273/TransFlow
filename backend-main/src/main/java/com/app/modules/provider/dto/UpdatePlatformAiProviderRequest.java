package com.app.modules.provider.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

import java.util.List;

/** Partial update: null fields are left unchanged; a non-blank {@code apiKey} rotates the key. */
public record UpdatePlatformAiProviderRequest(
        @Size(max = 100, message = "name cannot exceed 100 characters")
        String name,

        List<String> capabilities,

        @Size(max = 500, message = "baseUrl cannot exceed 500 characters")
        String baseUrl,

        String apiKey,

        @Size(max = 200, message = "defaultModel cannot exceed 200 characters")
        String defaultModel,

        @Min(value = 0, message = "priority must be between 0 and 1000")
        @Max(value = 1000, message = "priority must be between 0 and 1000")
        Integer priority,

        @Min(value = 1, message = "weight must be between 1 and 100")
        @Max(value = 100, message = "weight must be between 1 and 100")
        Integer weight,

        String tier,

        Boolean isActive
) {
}
