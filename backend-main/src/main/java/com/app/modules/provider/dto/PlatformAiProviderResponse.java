package com.app.modules.provider.dto;

import com.app.modules.provider.entity.PlatformAiProvider;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Super Admin view of a shared platform key. The key itself is never returned, only its hint. */
public record PlatformAiProviderResponse(
        UUID id,
        String name,
        String protocol,
        List<String> capabilities,
        String baseUrl,
        String apiKeyHint,
        String defaultModel,
        boolean isActive,
        int priority,
        int weight,
        String tier,
        String healthStatus,
        boolean coolingDown,
        Instant lastCheckedAt,
        String lastErrorCode,
        Instant createdAt,
        Instant updatedAt
) {
    public static PlatformAiProviderResponse from(PlatformAiProvider p, boolean coolingDown) {
        return new PlatformAiProviderResponse(p.getId(), p.getName(), p.getProtocol(),
                p.getCapabilities() == null ? List.of() : List.copyOf(p.getCapabilities()),
                p.getBaseUrl(), p.getApiKeyHint(), p.getDefaultModel(), p.isActive(), p.getPriority(),
                p.getWeight(), p.getTier().name(), p.getHealthStatus().name(), coolingDown,
                p.getLastCheckedAt(), p.getLastErrorCode(), p.getCreatedAt(), p.getUpdatedAt());
    }
}
