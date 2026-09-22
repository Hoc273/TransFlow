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

    /**
     * Synthesizes a single short TTS segment via {@code POST /media/tts} and returns the
     * decoded mp3 bytes. Any gateway failure (transport error, overall {@code FAILED}
     * status, or a failed/empty segment) is thrown as {@code TTS_PREVIEW_FAILED}.
     */
    byte[] synthesizeTts(String protocol, String baseUrl, String apiKey, String model,
                         String voiceId, String text, String correlationId);

    record DiscoveredVoice(
            String voiceId,
            String language,
            List<String> languages,
            String gender,
            String displayName
    ) {}
}
