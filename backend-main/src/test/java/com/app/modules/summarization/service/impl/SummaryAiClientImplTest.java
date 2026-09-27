package com.app.modules.summarization.service.impl;

import com.app.common.exception.AiStageException;
import com.app.modules.provider.service.ProviderResolverService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.http.HttpMethod.POST;

@ExtendWith(MockitoExtension.class)
class SummaryAiClientImplTest {

    @Mock
    private ProviderResolverService providerResolver;

    private MockRestServiceServer server;
    private SummaryAiClientImpl client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new SummaryAiClientImpl(builder.build(), providerResolver, new ObjectMapper());
    }

    @Test
    void calibratedVoiceRateIsSentAsTheNarrationBudget() {
        UUID userId = UUID.randomUUID();
        when(providerResolver.resolveForCapability(userId, "TRANSLATE")).thenReturn(
                new ProviderResolverService.ProviderResolution(UUID.randomUUID(), "dashscope_native",
                        "https://dashscope.example/api", "secret", "qwen3.8-max", true));
        server.expect(requestTo("http://ai.test/media/summarize/script"))
                .andExpect(jsonPath("$.narration_cps").value(17.4))
                .andRespond(withSuccess("""
                        {"correlation_id":"c","status":"COMPLETED","script_content":"Kịch bản.",
                         "segments":[{"start_ms":0,"end_ms":5000,"script_excerpt":"Kịch bản."}]}
                        """, MediaType.APPLICATION_JSON));

        client.generateScript("[]", null, 5, "vi", UUID.randomUUID(), userId, 17.4);

        server.verify();
    }

    @Test
    void scriptQuotaFailurePreservesProviderMetadataForSpringStage() {
        UUID userId = UUID.randomUUID();
        UUID providerId = UUID.randomUUID();
        when(providerResolver.resolveForCapability(userId, "TRANSLATE")).thenReturn(
                new ProviderResolverService.ProviderResolution(providerId, "dashscope_native",
                        "https://dashscope.example/api", "secret", "qwen-plus", true));

        server.expect(requestTo("http://ai.test/media/summarize/script"))
                .andExpect(method(POST))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.provider.model").value("qwen-plus"))
                .andRespond(withSuccess("""
                        {"correlation_id":"script-1","status":"FAILED",
                         "error":"Provider quota has been exhausted",
                         "error_detail":{"errorCode":"PROVIDER_QUOTA_EXCEEDED",
                           "title":"Quota Exceeded",
                           "message":"Provider quota has been exhausted",
                           "retryable":false,
                           "recommendedAction":"Check provider billing and quota.",
                           "protocol":"dashscope_native","capability":"TEXT","model":"qwen-plus"}}
                        """, MediaType.APPLICATION_JSON));

        AiStageException failure = assertThrows(AiStageException.class,
                () -> client.generateScript("[]", null, 5, "vi", UUID.randomUUID(), userId));

        server.verify();
        assertEquals("PROVIDER_QUOTA_EXCEEDED", failure.getErrorCode());
        assertEquals("Provider quota has been exhausted", failure.getMessage());
        assertEquals("qwen-plus", failure.getModel());
        assertEquals("dashscope_native", failure.getProtocol());
        assertEquals("TEXT", failure.getCapability());
        assertFalse(failure.isRetryable());
        assertEquals("Check provider billing and quota.", failure.getRecommendedAction());
        assertEquals("PROVIDER_QUOTA_EXCEEDED", failure.getErrorDetail().get("errorCode"));
        assertEquals("qwen-plus", failure.getErrorDetail().get("model"));
    }
}
