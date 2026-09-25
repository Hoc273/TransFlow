package com.app.modules.provider.dto;

import com.app.modules.provider.entity.UserAiProvider;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record UserAiProviderResponse(
        UUID id,
        UUID userId,
        String protocol,
        List<String> capabilities,
        String baseUrl,
        String apiKeyHint,
        String defaultModel,
        boolean isActive,
        Instant createdAt,
        Instant updatedAt,
        List<String> defaultForCapabilities,
        /** Daily key check: UNKNOWN, HEALTHY or DOWN (key rejected by its provider). */
        String healthStatus,
        Instant lastCheckedAt
) {
    public static UserAiProviderResponse from(UserAiProvider entity) {
        return from(entity, List.of());
    }

    public static UserAiProviderResponse from(UserAiProvider entity, List<String> defaultForCapabilities) {
        return new UserAiProviderResponse(
                entity.getId(),
                entity.getUserId(),
                entity.getProtocol(),
                entity.getCapabilities(),
                entity.getBaseUrl(),
                entity.getApiKeyHint(),
                entity.getDefaultModel(),
                entity.isActive(),
                entity.getCreatedAt(),
                entity.getUpdatedAt(),
                defaultForCapabilities,
                entity.getHealthStatus() == null ? "UNKNOWN" : entity.getHealthStatus().name(),
                entity.getLastCheckedAt()
        );
    }
}
