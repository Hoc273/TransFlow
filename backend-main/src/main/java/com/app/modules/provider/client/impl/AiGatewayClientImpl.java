package com.app.modules.provider.client.impl;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.provider.client.AiGatewayClient;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.client.ClientHttpRequestFactories;
import org.springframework.boot.web.client.ClientHttpRequestFactorySettings;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class AiGatewayClientImpl implements AiGatewayClient {

    private static final Logger log = LoggerFactory.getLogger(AiGatewayClientImpl.class);

    private final RestClient restClient;

    @org.springframework.beans.factory.annotation.Autowired
    public AiGatewayClientImpl(AppProperties props) {
        AppProperties.Ai ai = props.ai();
        var settings = ClientHttpRequestFactorySettings.DEFAULTS
                .withConnectTimeout(Duration.ofMillis(ai.connectTimeoutMs()))
                .withReadTimeout(Duration.ofMillis(ai.readTimeoutMs()));

        this.restClient = RestClient.builder()
                .baseUrl(ai.baseUrl())
                .requestFactory(ClientHttpRequestFactories.get(settings))
                .build();
    }

    public AiGatewayClientImpl(RestClient restClient) {
        this.restClient = restClient;
    }

    @Override
    public boolean testConnection(String protocol, String baseUrl, String apiKey) {
        try {
            Map<String, Object> body = Map.of(
                    "protocol", protocol != null ? protocol : "openai_compatible",
                    "base_url", baseUrl,
                    "api_key", apiKey != null ? apiKey : ""
            );

            Map<?, ?> response = restClient.post()
                    .uri("/ai/validate/auth")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(Map.class);

            if (response != null && Boolean.TRUE.equals(response.get("ok"))) {
                return true;
            }
            log.warn("Auth probe returned ok=false: {}", response);
            return false;
        } catch (Exception ex) {
            log.warn("Failed to test AI provider connection via FastAPI: {}", ex.getMessage());
            return false;
        }
    }

    @Override
    public List<DiscoveredVoice> fetchTtsVoices(String protocol, String baseUrl, String apiKey, String defaultModel) {
        try {
            Map<String, Object> body = Map.of(
                    "protocol", protocol != null ? protocol : "openai_compatible",
                    "base_url", baseUrl,
                    "api_key", apiKey != null ? apiKey : "",
                    "capabilities", List.of("TTS"),
                    "model", defaultModel != null ? defaultModel : ""
            );

            FastApiTtsVoicesResponse response = restClient.post()
                    .uri("/media/tts/voices")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(FastApiTtsVoicesResponse.class);

            if (response == null || response.voices == null) {
                return List.of();
            }

            List<DiscoveredVoice> result = new ArrayList<>();
            for (FastApiVoice v : response.voices) {
                result.add(new DiscoveredVoice(
                        v.voiceId,
                        v.language != null ? v.language : "en",
                        v.languages != null ? v.languages : List.of(v.language != null ? v.language : "en"),
                        v.gender != null ? v.gender : "UNKNOWN",
                        v.displayName != null ? v.displayName : v.voiceId
                ));
            }
            return result;
        } catch (Exception ex) {
            log.error("Failed to fetch TTS voices from AI service: {}", ex.getMessage());
            throw new AppException(ErrorCode.PROVIDER_VOICES_FETCH_FAILED);
        }
    }

    @Override
    public String synthesizeTtsPreview(String protocol, String baseUrl, String apiKey, String model,
                                       String voiceId, String text) {
        Map<String, Object> body = Map.of(
                "correlation_id", UUID.randomUUID().toString(),
                "media_job_id", "voice-preview",
                "voice_id", voiceId,
                "segments", List.of(Map.of("segment_id", "preview", "target_text", text)),
                "provider", Map.of(
                        "protocol", protocol != null ? protocol : "openai_compatible",
                        "base_url", baseUrl,
                        "api_key", apiKey != null ? apiKey : "",
                        "model", model != null ? model : "",
                        "capabilities", List.of("TTS")
                )
        );

        FastApiTtsResponse response;
        try {
            response = restClient.post()
                    .uri("/media/tts")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(FastApiTtsResponse.class);
        } catch (Exception ex) {
            log.error("TTS preview synthesize call failed: {}", ex.getMessage());
            throw new AppException(ErrorCode.TTS_PREVIEW_FAILED);
        }

        if (response == null || response.results == null) {
            log.warn("TTS preview returned no results (status={})", response != null ? response.status : null);
            return null;
        }
        for (FastApiTtsResult r : response.results) {
            if (!"preview".equals(r.segmentId)) {
                continue;
            }
            boolean ok = "SUCCESS".equalsIgnoreCase(r.status) || "COMPLETED".equalsIgnoreCase(r.status);
            if (ok && r.audioBase64 != null && !r.audioBase64.isBlank()) {
                return r.audioBase64;
            }
            log.warn("TTS preview segment failed: status={} error={} errorCode={}", r.status, r.error, r.errorCode);
            return null;
        }
        return null;
    }

    public static class FastApiTtsResponse {
        @JsonProperty("correlation_id")
        public String correlationId;

        @JsonProperty("status")
        public String status;

        @JsonProperty("results")
        public List<FastApiTtsResult> results;

        @JsonProperty("error")
        public String error;
    }

    public static class FastApiTtsResult {
        @JsonProperty("segment_id")
        public String segmentId;

        @JsonProperty("status")
        public String status;

        @JsonProperty("audio_base64")
        public String audioBase64;

        @JsonProperty("error")
        public String error;

        @JsonProperty("errorCode")
        public String errorCode;
    }

    public static class FastApiTtsVoicesResponse {
        @JsonProperty("protocol")
        public String protocol;

        @JsonProperty("voices")
        public List<FastApiVoice> voices;
    }

    public static class FastApiVoice {
        @JsonProperty("voice_id")
        public String voiceId;

        @JsonProperty("language")
        public String language;

        @JsonProperty("languages")
        public List<String> languages;

        @JsonProperty("gender")
        public String gender;

        @JsonProperty("display_name")
        public String displayName;
    }
}
