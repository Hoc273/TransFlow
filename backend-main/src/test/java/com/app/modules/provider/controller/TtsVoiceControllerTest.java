package com.app.modules.provider.controller;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class TtsVoiceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PlatformAiProviderRepository platformAiProviderRepository;

    @Autowired
    private TtsVoiceRepository ttsVoiceRepository;

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

    @BeforeEach
    void seedPlatformVoices() {
        ttsVoiceRepository.deleteAll();
        platformAiProviderRepository.deleteAll();

        PlatformAiProvider platform = new PlatformAiProvider();
        platform.setProtocol("openai_compatible");
        platform.setBaseUrl("https://api.openai.com/v1");
        platform.setCapabilities(List.of("TTS"));
        platform.setApiKeyEnc(new byte[]{1, 2, 3});
        platform = platformAiProviderRepository.save(platform);

        TtsVoice v1 = new TtsVoice();
        v1.setProviderSource("PLATFORM");
        v1.setPlatformProviderId(platform.getId());
        v1.setVoiceId("alloy");
        v1.setLanguage("en");
        v1.setLanguages(List.of("en", "vi"));
        v1.setGender("UNKNOWN");
        v1.setActive(true);
        ttsVoiceRepository.save(v1);

        TtsVoice v2 = new TtsVoice();
        v2.setProviderSource("PLATFORM");
        v2.setPlatformProviderId(platform.getId());
        v2.setVoiceId("echo");
        v2.setLanguage("en");
        v2.setLanguages(List.of("en"));
        v2.setGender("MALE");
        v2.setActive(true);
        ttsVoiceRepository.save(v2);
    }

    @Test
    void testListPlatformVoicesSuccess() throws Exception {
        String token = registerAndGetToken("tts_user_" + System.currentTimeMillis() + "@test.com", "TTS User");

        mockMvc.perform(get("/api/tts-voices")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(2));
    }

    @Test
    void testListPlatformVoicesWithLanguageFilter() throws Exception {
        String token = registerAndGetToken("tts_user2_" + System.currentTimeMillis() + "@test.com", "TTS User 2");

        mockMvc.perform(get("/api/tts-voices?language=vi")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].voiceId").value("alloy"));
    }

    @Test
    void testListPlatformVoicesUnauthenticatedReturns401() throws Exception {
        mockMvc.perform(get("/api/tts-voices"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHENTICATED.getCode()));
    }
}
