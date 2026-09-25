package com.app.modules.provider.controller;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.dto.CreateUserAiProviderRequest;
import com.app.modules.provider.dto.UpdateUserAiProviderRequest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class UserAiProviderControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AiGatewayClient aiGatewayClient;

    private String registerAndGetToken(String email, String name) throws Exception {
        RegisterRequest reg = new RegisterRequest(email, "Password123!", name);
        MvcResult res = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode json = objectMapper.readTree(res.getResponse().getContentAsString()).path("data");
        return json.path("accessToken").asText();
    }

    @Test
    void testUserAiProviderFullLifecycle() throws Exception {
        String token = registerAndGetToken("provider_user_" + System.currentTimeMillis() + "@test.com", "Provider User");

        // 1. Initially empty
        mockMvc.perform(get("/api/users/me/providers")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(0));

        // 2. Create BYOK provider
        CreateUserAiProviderRequest createReq = new CreateUserAiProviderRequest(
                "openai_compatible",
                List.of("TRANSLATE", "TTS"),
                "https://api.openai.com/v1",
                "sk-proj-test-1234567890abcdef",
                "gpt-4o"
        );

        MvcResult createRes = mockMvc.perform(post("/api/users/me/providers")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createReq)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.protocol").value("openai_compatible"))
                .andExpect(jsonPath("$.data.apiKeyHint").value("sk-...cdef"))
                .andExpect(jsonPath("$.data.apiKey").doesNotExist())
                .andExpect(jsonPath("$.data.apiKeyEnc").doesNotExist())
                .andReturn();

        String providerId = objectMapper.readTree(createRes.getResponse().getContentAsString())
                .path("data").path("id").asText();

        // 3. Get provider by ID
        mockMvc.perform(get("/api/users/me/providers/" + providerId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.id").value(providerId))
                .andExpect(jsonPath("$.data.defaultModel").value("gpt-4o"));

        // 4. Update provider
        UpdateUserAiProviderRequest updateReq = new UpdateUserAiProviderRequest(
                null,
                null,
                "https://api.openai.com/v2",
                null,
                "gpt-4o-mini",
                true
        );

        mockMvc.perform(put("/api/users/me/providers/" + providerId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.baseUrl").value("https://api.openai.com/v2"))
                .andExpect(jsonPath("$.data.defaultModel").value("gpt-4o-mini"));

        // 5. Test connection
        when(aiGatewayClient.testConnection(anyString(), anyString(), anyString())).thenReturn(true);
        when(aiGatewayClient.probeCapability(anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenAnswer(invocation -> new AiGatewayClient.ProviderCapabilityProbe(
                        true, invocation.getArgument(3), null, "Provider model probe passed"));

        mockMvc.perform(post("/api/users/me/providers/" + providerId + "/test")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.success").value(true));

        // 6. Refresh voices
        when(aiGatewayClient.fetchTtsVoices(anyString(), anyString(), anyString(), anyString()))
                .thenReturn(List.of(
                        new AiGatewayClient.DiscoveredVoice("alloy", "en", List.of("en", "vi"), "UNKNOWN", "Alloy"),
                        new AiGatewayClient.DiscoveredVoice("nova", "en", List.of("en"), "FEMALE", "Nova")
                ));

        mockMvc.perform(post("/api/users/me/providers/" + providerId + "/voices/refresh")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(2));

        // 7. List voices with filter
        mockMvc.perform(get("/api/users/me/providers/" + providerId + "/voices?language=vi")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].voiceId").value("alloy"));

        // 8. Delete provider
        mockMvc.perform(delete("/api/users/me/providers/" + providerId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000));

        // 9. Confirm deleted
        mockMvc.perform(get("/api/users/me/providers/" + providerId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(ErrorCode.PROVIDER_NOT_FOUND.getCode()));
    }

    @Test
    void testValidationFailureReturnsCode9998() throws Exception {
        String token = registerAndGetToken("val_user_" + System.currentTimeMillis() + "@test.com", "Val User");

        // Missing protocol and apiKey
        String invalidBody = "{\"baseUrl\":\"https://api.openai.com/v1\",\"capabilities\":[]}";

        mockMvc.perform(post("/api/users/me/providers")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(invalidBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    @Test
    void testUnauthenticatedAccessReturns401() throws Exception {
        mockMvc.perform(get("/api/users/me/providers"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHENTICATED.getCode()));
    }
}
