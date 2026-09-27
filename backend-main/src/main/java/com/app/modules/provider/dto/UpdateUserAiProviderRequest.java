package com.app.modules.provider.dto;

import jakarta.validation.constraints.Size;

import java.util.List;

public record UpdateUserAiProviderRequest(
        String protocol,
        List<String> capabilities,
        @Size(max = 500, message = "baseUrl cannot exceed 500 characters")
        String baseUrl,
        String apiKey,
        @Size(max = 200, message = "defaultModel cannot exceed 200 characters")
        String defaultModel,
        Boolean isActive,
        List<String> defaultForCapabilities
) {
    public UpdateUserAiProviderRequest(String protocol, List<String> capabilities, String baseUrl,
                                      String apiKey, String defaultModel, Boolean isActive) {
        this(protocol, capabilities, baseUrl, apiKey, defaultModel, isActive, null);
    }
}
