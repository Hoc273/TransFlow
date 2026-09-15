package com.app.modules.provider.service;

import java.util.UUID;

/**
 * Interface provided by Member A for Member B to resolve AI provider credentials
 * (BYOK or platform) for a given capability before calling FastAPI (backend-ai).
 * See CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §4.
 */
public interface ProviderResolverService {

    ProviderResolution resolveForCapability(UUID userId, String capability);

    record ProviderResolution(
            String providerType,
            String apiKey,
            String endpointUrl,
            boolean isPersonalApiKey
    ) {}
}
