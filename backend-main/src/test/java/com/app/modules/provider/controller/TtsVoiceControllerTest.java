package com.app.modules.provider.controller;

import com.app.common.crypto.CryptoService;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.service.TtsVoicePreviewRateLimiter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.when;
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

    @Autowired
    private CryptoService cryptoService;

    @MockBean
    private AiGatewayClient aiGatewayClient;

    @MockBean
    private MediaStorageService mediaStorageService;

    @MockBean
    private TtsVoicePreviewRateLimiter previewRateLimiter;

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

    private PlatformAiProvider platform;
    private TtsVoice platformVoice;

    @BeforeEach
    void seedPlatformVoices() {
        ttsVoiceRepository.deleteAll();
        platformAiProviderRepository.deleteAll();

        PlatformAiProvider p = new PlatformAiProvider();
        p.setProtocol("openai_compatible");
        p.setBaseUrl("https://api.openai.com/v1");
        p.setCapabilities(List.of("TTS"));
        p.setApiKeyEnc(cryptoService.encrypt("sk-test-platform"));
        p.setDefaultModel("gpt-4o-mini-tts");
        platform = platformAiProviderRepository.save(p);

        TtsVoice v1 = new TtsVoice();
        v1.setProviderSource("PLATFORM");
        v1.setPlatformProviderId(platform.getId());
        platformVoice = v1;
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

    // ── POST /api/tts-voices/preview ─────────────────────────────────────────

    @Test
    void testPreviewVoiceSuccess() throws Exception {
        String token = registerAndGetToken("tts_prev_" + System.currentTimeMillis() + "@test.com", "TTS Preview");

        byte[] fakeMp3 = new byte[]{0x49, 0x44, 0x33, 0x04, 0x00}; // "ID3" header
        when(aiGatewayClient.synthesizeTtsPreview(anyString(), anyString(), anyString(), anyString(),
                eq("alloy"), eq("Xin chào")))
                .thenReturn(Base64.getEncoder().encodeToString(fakeMp3));
        when(mediaStorageService.mediaBucket()).thenReturn("transflow-media");
        when(mediaStorageService.presignedGetUrl(anyString())).thenReturn("http://minio/presigned-url");
        doNothing().when(previewRateLimiter).check(org.mockito.ArgumentMatchers.any());

        mockMvc.perform(post("/api/tts-voices/preview")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"voiceId\":\"" + platformVoice.getId() + "\",\"text\":\"Xin chào\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.audioUrl").value("http://minio/presigned-url"))
                .andExpect(jsonPath("$.data.expiresInSeconds").value(3600));
    }

    @Test
    void testPreviewVoiceNotFoundReturns404() throws Exception {
        String token = registerAndGetToken("tts_prev404_" + System.currentTimeMillis() + "@test.com", "TTS Preview");

        mockMvc.perform(post("/api/tts-voices/preview")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"voiceId\":\"" + UUID.randomUUID() + "\",\"text\":\"Xin chào\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(ErrorCode.TTS_VOICE_NOT_FOUND.getCode()));
    }

    @Test
    void testPreviewVoiceTextTooLongReturns400() throws Exception {
        String token = registerAndGetToken("tts_prev400_" + System.currentTimeMillis() + "@test.com", "TTS Preview");
        String longText = "a".repeat(51);

        mockMvc.perform(post("/api/tts-voices/preview")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"voiceId\":\"" + platformVoice.getId() + "\",\"text\":\"" + longText + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    @Test
    void testPreviewVoiceUnauthenticatedReturns401() throws Exception {
        mockMvc.perform(post("/api/tts-voices/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"voiceId\":\"" + UUID.randomUUID() + "\",\"text\":\"hi\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHENTICATED.getCode()));
    }
}
