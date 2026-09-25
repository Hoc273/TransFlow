package com.app.common.exception;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class AiStageExceptionTest {

    @Test
    void operationErrorIsUsedAsLegacyMessageFallback() throws Exception {
        JsonNode response = new ObjectMapper().readTree("""
                {"status":"FAILED","error":"Provider quota has been exhausted"}
                """);

        AiStageException failure = AiStageException.fromOperationResponse(response);

        assertEquals("PROVIDER_UNKNOWN", failure.getErrorCode());
        assertEquals("Provider quota has been exhausted", failure.getMessage());
    }

    @Test
    void structuredProviderCodeTakesPriorityOverHttpStatus() {
        String body = """
                {"error_detail":{"errorCode":"PROVIDER_QUOTA_EXCEEDED","message":"Provider quota has been exhausted",
                  "retryable":false,"recommendedAction":"Check billing","protocol":"dashscope_native",
                  "capability":"TEXT","model":"qwen-plus"}}
                """;
        HttpClientErrorException response = HttpClientErrorException.create(
                HttpStatus.FORBIDDEN, "Forbidden", HttpHeaders.EMPTY,
                body.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8);

        AiStageException failure = AiStageException.fromRestClientResponse(
                response, new ObjectMapper(), "TEXT", "fallback-model");

        assertEquals("PROVIDER_QUOTA_EXCEEDED", failure.getErrorCode());
        assertEquals("Provider quota has been exhausted", failure.getMessage());
        assertEquals("qwen-plus", failure.getModel());
        assertFalse(failure.isRetryable());
    }
}
