package com.app.modules.provider.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public record CreateUserAiProviderRequest(
        @NotBlank(message = "protocol is required")
        String protocol,

        @NotEmpty(message = "capabilities must not be empty")
        List<String> capabilities,

        @NotBlank(message = "baseUrl is required")
        @Size(max = 500, message = "baseUrl cannot exceed 500 characters")
        String baseUrl,

        @NotBlank(message = "apiKey is required")
        String apiKey,

        @Size(max = 200, message = "defaultModel cannot exceed 200 characters")
        String defaultModel
) {}
