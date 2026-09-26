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

    ProviderCapabilityProbe probeCapability(String protocol, String baseUrl, String apiKey,
                                             String model, String capability);

    /**
     * Discovers and retrieves available TTS voices for a provider via FastAPI.
     */
    List<DiscoveredVoice> fetchTtsVoices(String protocol, String baseUrl, String apiKey, String defaultModel);

    /**
     * Synthesizes a short TTS preview clip via {@code POST /media/tts} (single "preview" segment).
     * Returns the base64-encoded audio, or {@code null} when the provider returned none.
     * Throws {@code AppException(TTS_PREVIEW_FAILED)} on transport-level failure.
     */
    String synthesizeTtsPreview(String protocol, String baseUrl, String apiKey, String model,
                                String voiceId, String text);

    record DiscoveredVoice(
            String voiceId,
            String language,
            List<String> languages,
            String gender,
            String displayName,
            String status
    ) {
        /** Pre-status call sites (tests, static catalogs): lifecycle unknown. */
        public DiscoveredVoice(String voiceId, String language, List<String> languages,
                               String gender, String displayName) {
            this(voiceId, language, languages, gender, displayName, null);
        }
    }

    record ProviderCapabilityProbe(boolean success, String model, String errorCode, String message) {}
}
