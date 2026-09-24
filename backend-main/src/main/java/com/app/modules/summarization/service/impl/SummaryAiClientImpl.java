package com.app.modules.summarization.service.impl;

import com.app.common.exception.AiStageException;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.summarization.service.DurationAwareSummaryAiClient;
import com.app.modules.summarization.service.SummaryAiClient;
import com.app.modules.summarization.service.UserAwareDurationSummaryAiClient;
import com.app.modules.summarization.service.UserAwareSummaryAiClient;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Spring-to-FastAPI client for script-first summary generation and refinement. */
@Service
public class SummaryAiClientImpl implements SummaryAiClient, UserAwareSummaryAiClient,
        UserAwareDurationSummaryAiClient, DurationAwareSummaryAiClient {

    private static final String TEXT_PROVIDER_CAPABILITY = "TRANSLATE";

    private final RestClient restClient;
    private final ProviderResolverService providerResolver;
    private final ObjectMapper objectMapper;

    @Autowired
    public SummaryAiClientImpl(@Qualifier("mediaAiRestClient") RestClient restClient,
                               ProviderResolverService providerResolver,
                               ObjectMapper objectMapper) {
        this.restClient = restClient;
        this.providerResolver = providerResolver;
        this.objectMapper = objectMapper;
    }

    @Override
    public ScriptProposalResult generateScript(String transcript, String visualContext,
                                               int requestedDurationSeconds, String targetLang) {
        return generateScript(transcript, visualContext, requestedDurationSeconds, targetLang, null, null);
    }

    @Override
    public ScriptProposalResult generateScript(String transcript, String visualContext,
                                               int requestedDurationSeconds, String targetLang,
                                               UUID userId) {
        return generateScript(transcript, visualContext, requestedDurationSeconds, targetLang,
                null, userId);
    }

    @Override
    public ScriptProposalResult generateScript(String transcript, String visualContext,
                                               int requestedDurationSeconds, String targetLang,
                                               UUID mediaJobId, UUID userId) {
        Map<String, Object> body = baseRequest(mediaJobId, userId);
        body.put("transcript", parseTranscript(transcript, requestedDurationSeconds));
        body.put("requested_duration_seconds", requestedDurationSeconds);
        body.put("target_lang", targetLang);
        putVisualContext(body, visualContext);
        return post("/media/summarize/script", body);
    }

    @Override
    public ScriptProposalResult refineScript(String previousScript, String feedbackText, String targetLang) {
        return refineScriptInternal(previousScript, feedbackText, targetLang, null, null, null);
    }

    @Override
    public ScriptProposalResult refineScript(String previousScript, String feedbackText, String targetLang,
                                             int requestedDurationSeconds) {
        return refineScriptInternal(previousScript, feedbackText, targetLang,
                requestedDurationSeconds, null, null);
    }

    @Override
    public ScriptProposalResult refineScript(String previousScript, String feedbackText, String targetLang,
                                             int requestedDurationSeconds, UUID userId) {
        return refineScriptInternal(previousScript, feedbackText, targetLang,
                requestedDurationSeconds, null, userId);
    }

    @Override
    public ScriptProposalResult refineScript(String previousScript, String feedbackText, String targetLang,
                                             int requestedDurationSeconds, UUID mediaJobId, UUID userId) {
        return refineScriptInternal(previousScript, feedbackText, targetLang,
                requestedDurationSeconds, mediaJobId, userId);
    }

    private ScriptProposalResult refineScriptInternal(String previousScript, String feedbackText,
                                                      String targetLang, Integer requestedDurationSeconds,
                                                      UUID mediaJobId, UUID userId) {
        Map<String, Object> body = baseRequest(mediaJobId, userId);
        body.put("previous_script", previousScript);
        body.put("feedback_text", feedbackText);
        body.put("target_lang", targetLang);
        if (requestedDurationSeconds != null) {
            body.put("requested_duration_seconds", requestedDurationSeconds);
        }
        return post("/media/summarize/refine", body);
    }

    private Map<String, Object> baseRequest(UUID mediaJobId, UUID userId) {
        UUID correlationId = UUID.randomUUID();
        ProviderResolverService.ProviderResolution provider =
                providerResolver.resolveForCapability(userId, TEXT_PROVIDER_CAPABILITY);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("correlation_id", correlationId.toString());
        body.put("media_job_id", mediaJobId == null ? "summary-" + correlationId : mediaJobId.toString());
        body.put("provider", Map.of(
                "protocol", valueOrEmpty(provider.providerType()),
                "base_url", valueOrEmpty(provider.baseUrl()),
                "api_key", valueOrEmpty(provider.apiKey()),
                "model", provider.model(),
                "capabilities", List.of("TEXT")));
        return body;
    }

    private ScriptProposalResult post(String path, Map<String, Object> body) {
        FastApiScriptResponse response;
        try {
            response = restClient.post()
                    .uri(path)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(FastApiScriptResponse.class);
        } catch (RestClientException ex) {
            if (ex instanceof RestClientResponseException responseError) {
                throw AiStageException.fromRestClientResponse(responseError, objectMapper, "TEXT", null);
            }
            throw AiStageException.safeFailure("PROVIDER_UNAVAILABLE", "AI provider is unavailable or timed out",
                    true, "Try again later or check the provider service.", "TEXT", null);
        }

        if (response == null) {
            throw AiStageException.safeFailure("PROVIDER_RESPONSE_MALFORMED",
                    "AI provider returned an incomplete response", false,
                    "Check the configured provider model and try the provider test again.", "TEXT", null);
        }
        if (!"COMPLETED".equalsIgnoreCase(response.status)) {
            if (response.errorDetail != null && response.errorDetail.isObject()) {
                throw AiStageException.fromDetail(response.errorDetail, null);
            }
            throw AiStageException.safeFailure("PROVIDER_UNKNOWN", "AI provider operation failed",
                    false, null, "TEXT", null);
        }

        List<SegmentDraft> segments = new ArrayList<>();
        if (response.segments != null) {
            for (FastApiScriptSegment segment : response.segments) {
                segments.add(new SegmentDraft(
                        segment.startMs,
                        segment.endMs,
                        segment.scriptExcerpt,
                        segment.sourceSentenceRefs == null ? List.of() : segment.sourceSentenceRefs,
                        segment.reasoningNote));
            }
        }

        BigDecimal confidence = response.confidence != null ? response.confidence : response.confidenceScore;
        return new ScriptProposalResult(
                response.scriptContent,
                response.scriptLanguage,
                segments,
                response.reasoningNote,
                confidence,
                response.warnings == null ? List.of() : response.warnings,
                response.usage == null ? 0L : response.usage.inputTokens,
                response.usage == null ? 0L : response.usage.outputTokens);
    }

    private List<Map<String, Object>> parseTranscript(String rawTranscript, int requestedDurationSeconds) {
        if (rawTranscript == null || rawTranscript.isBlank()) {
            return List.of();
        }
        try {
            JsonNode root = objectMapper.readTree(rawTranscript);
            JsonNode array = root != null && root.isObject() && root.path("segments").isArray()
                    ? root.path("segments") : root;
            if (array != null && array.isArray()) {
                List<Map<String, Object>> segments = new ArrayList<>();
                for (JsonNode node : array) {
                    Map<String, Object> segment = new LinkedHashMap<>();
                    segment.put("text", node.path("text").asText(""));
                    long start = node.has("start_ms") ? node.path("start_ms").asLong()
                            : node.path("startMs").asLong(0);
                    long end = node.has("end_ms") ? node.path("end_ms").asLong()
                            : node.path("endMs").asLong(start + 1);
                    segment.put("start_ms", Math.max(0L, start));
                    segment.put("end_ms", Math.max(start + 1, end));
                    segments.add(segment);
                }
                return segments;
            }
        } catch (Exception ignored) {
            // A plain transcript string is converted to one valid STT segment below.
        }

        return List.of(Map.of(
                "text", rawTranscript,
                "start_ms", 0L,
                "end_ms", Math.max(1L, requestedDurationSeconds * 1000L)));
    }

    private void putVisualContext(Map<String, Object> body, String visualContext) {
        if (visualContext == null || visualContext.isBlank()) {
            return;
        }
        try {
            body.put("visual_context", objectMapper.readTree(visualContext));
        } catch (Exception ignored) {
            body.put("visual_context", visualContext);
        }
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static final class FastApiScriptResponse {
        @JsonProperty("status")
        private String status;
        @JsonProperty("script_content")
        private String scriptContent;
        @JsonProperty("script_language")
        private String scriptLanguage;
        @JsonProperty("segments")
        private List<FastApiScriptSegment> segments;
        @JsonProperty("reasoning_note")
        private String reasoningNote;
        @JsonProperty("confidence")
        private BigDecimal confidence;
        @JsonProperty("confidence_score")
        private BigDecimal confidenceScore;
        @JsonProperty("warnings")
        private List<String> warnings;
        @JsonProperty("usage")
        private FastApiUsage usage;
        @JsonProperty("error")
        private String error;
        @JsonProperty("error_detail")
        private JsonNode errorDetail;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static final class FastApiUsage {
        @JsonProperty("input_tokens")
        private long inputTokens;
        @JsonProperty("output_tokens")
        private long outputTokens;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static final class FastApiScriptSegment {
        @JsonProperty("start_ms")
        private long startMs;
        @JsonProperty("end_ms")
        private long endMs;
        @JsonProperty("script_excerpt")
        private String scriptExcerpt;
        @JsonProperty("source_sentence_refs")
        private List<String> sourceSentenceRefs;
        @JsonProperty("reasoning_note")
        private String reasoningNote;
    }
}
