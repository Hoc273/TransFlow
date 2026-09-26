package com.app.common.exception;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.client.RestClientResponseException;

import java.util.LinkedHashMap;
import java.util.Map;

/** Safe, structured failure returned by an AI operation to a media stage. */
public class AiStageException extends RuntimeException {

    private final String errorCode;
    private final boolean retryable;
    private final String recommendedAction;
    private final String protocol;
    private final String capability;
    private final String model;
    private final Map<String, Object> errorDetail;

    public AiStageException(String errorCode, String message, boolean retryable,
                            String recommendedAction, String protocol, String capability,
                            String model, Map<String, Object> errorDetail) {
        super(message);
        this.errorCode = errorCode;
        this.retryable = retryable;
        this.recommendedAction = recommendedAction;
        this.protocol = protocol;
        this.capability = capability;
        this.model = model;
        this.errorDetail = errorDetail == null ? new LinkedHashMap<>() : new LinkedHashMap<>(errorDetail);
    }

    public static AiStageException fromDetail(JsonNode detail, String fallbackMessage) {
        String code = text(detail, "errorCode", "PROVIDER_UNKNOWN");
        String message = text(detail, "message", fallbackMessage == null ? "AI provider request failed" : fallbackMessage);
        boolean retryable = detail != null && detail.path("retryable").asBoolean(false);
        String action = text(detail, "recommendedAction", null);
        String protocol = text(detail, "protocol", null);
        String capability = text(detail, "capability", null);
        String model = text(detail, "model", null);
        Map<String, Object> body = detail == null ? new LinkedHashMap<>() : new ObjectMapper().convertValue(detail, Map.class);
        body.putIfAbsent("errorCode", code);
        body.putIfAbsent("message", message);
        body.putIfAbsent("retryable", retryable);
        return new AiStageException(code, message, retryable, action, protocol, capability, model, body);
    }

    public static AiStageException fromOperationResponse(JsonNode response) {
        JsonNode detail = response == null ? null : response.path("error_detail");
        String operationError = text(response, "error", "AI provider operation failed");
        if (detail != null && detail.isObject()) return fromDetail(detail, operationError);
        return safeFailure("PROVIDER_UNKNOWN", operationError, false, null, null, null);
    }

    public static AiStageException fromRestClientResponse(RestClientResponseException exception,
                                                          ObjectMapper mapper,
                                                          String capability, String model) {
        try {
            JsonNode body = mapper.readTree(exception.getResponseBodyAsString());
            JsonNode detail = body.path("error_detail");
            if (!detail.isObject()) detail = body.path("errorDetail");
            if (!detail.isObject() && body.path("errorCode").isTextual()) detail = body;
            if (detail.isObject() && detail.path("errorCode").isTextual()) {
                Map<String, Object> fields = mapper.convertValue(detail, Map.class);
                fields.putIfAbsent("capability", capability);
                fields.putIfAbsent("model", model);
                return fromDetail(mapper.valueToTree(fields), null);
            }
        } catch (Exception ignored) {
            // Fall back to a safe status classification; never expose the raw body.
        }
        int status = exception.getStatusCode().value();
        String code = status == 401 ? "PROVIDER_AUTH_FAILED"
                : status == 403 ? "PROVIDER_PERMISSION_DENIED"
                : status == 404 ? "PROVIDER_ENDPOINT_NOT_FOUND"
                : status == 429 ? "PROVIDER_RATE_LIMITED"
                : status == 504 ? "PROVIDER_TIMEOUT"
                : status >= 500 ? "PROVIDER_UNAVAILABLE"
                : "PROVIDER_BAD_REQUEST";
        return safeFailure(code, safeMessage(code), status == 429 || status >= 500,
                null, capability, model);
    }

    public static AiStageException fromAppException(AppException exception, String capability) {
        ErrorCode sourceCode = exception.getErrorCode();
        String code = sourceCode == null ? "PROVIDER_CONFIGURATION_ERROR" : sourceCode.name();
        String message = sourceCode == null ? "AI provider configuration is invalid" : sourceCode.getMessage();
        String action = sourceCode == ErrorCode.INSUFFICIENT_CREDIT
                ? "Top up credit, then rerun this stage."
                : "Review the provider configuration and selected model.";
        return safeFailure(code, message, false, action, capability, null);
    }

    /** Copy of this failure with extra structured detail (e.g. how many segments are missing). */
    public AiStageException withDetail(Map<String, Object> extra) {
        Map<String, Object> detail = new LinkedHashMap<>(errorDetail);
        detail.putAll(extra);
        return new AiStageException(errorCode, getMessage(), retryable, recommendedAction, protocol, capability,
                model, detail);
    }

    public static AiStageException safeFailure(String code, String message, boolean retryable,
                                               String action, String capability, String model) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("errorCode", code);
        detail.put("title", title(code));
        detail.put("message", message);
        detail.put("retryable", retryable);
        if (action != null) detail.put("recommendedAction", action);
        if (capability != null) detail.put("capability", capability);
        if (model != null) detail.put("model", model);
        return new AiStageException(code, message, retryable, action, null, capability, model, detail);
    }

    private static String text(JsonNode node, String field, String fallback) {
        JsonNode value = node == null ? null : node.get(field);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText() : fallback;
    }

    private static String safeMessage(String code) {
        return switch (code) {
            case "PROVIDER_AUTH_FAILED" -> "Provider authentication failed";
            case "PROVIDER_PERMISSION_DENIED" -> "Provider permission was denied";
            case "PROVIDER_RATE_LIMITED" -> "Provider rate limit has been reached";
            case "PROVIDER_TIMEOUT" -> "Provider request timed out";
            case "PROVIDER_UNAVAILABLE" -> "Provider service is unavailable";
            case "PROVIDER_ENDPOINT_NOT_FOUND" -> "Provider endpoint was not found";
            default -> "Provider rejected the request";
        };
    }

    private static String title(String code) {
        return code == null ? "AI Provider Error" : code.replace("PROVIDER_", "").replace('_', ' ');
    }

    public String getErrorCode() { return errorCode; }
    public boolean isRetryable() { return retryable; }
    public String getRecommendedAction() { return recommendedAction; }
    public String getProtocol() { return protocol; }
    public String getCapability() { return capability; }
    public String getModel() { return model; }
    public Map<String, Object> getErrorDetail() { return errorDetail; }
}
