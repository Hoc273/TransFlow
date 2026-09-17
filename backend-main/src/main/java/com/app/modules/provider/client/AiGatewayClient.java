package com.app.modules.provider.client;

import java.util.List;

/**
 * Client for communicating with the FastAPI AI Gateway (backend-ai).
 */
public interface AiGatewayClient {

    /**
     * Probes provider connectivity and auth credentials via FastAPI.
     * Returns true if connection and authentication succeeded.
     */
    boolean testConnection(String protocol, String baseUrl, String apiKey);

    /**
     * Discovers and retrieves available TTS voices for a provider via FastAPI.
     */
    List<DiscoveredVoice> fetchTtsVoices(String protocol, String baseUrl, String apiKey, String defaultModel);

    record DiscoveredVoice(
            String voiceId,
            String language,
            List<String> languages,
            String gender,
            String displayName
    ) {}
}
