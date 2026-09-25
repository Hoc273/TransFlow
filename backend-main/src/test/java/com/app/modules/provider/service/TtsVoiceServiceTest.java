package com.app.modules.provider.service;

import com.app.common.config.AppProperties;
import com.app.common.crypto.CryptoService;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.dto.PreviewTtsVoiceRequest;
import com.app.modules.provider.dto.PreviewTtsVoiceResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.entity.UserAiProvider;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.repository.UserAiProviderRepository;
import com.app.modules.provider.service.impl.TtsVoiceServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TtsVoiceServiceTest {

    @Mock
    private TtsVoiceRepository ttsVoiceRepository;

    @Mock
    private UserAiProviderRepository userAiProviderRepository;

    @Mock
    private PlatformAiProviderRepository platformAiProviderRepository;

    @Mock
    private CryptoService cryptoService;

    @Mock
    private AiGatewayClient aiGatewayClient;

    @Mock
    private MediaStorageService mediaStorageService;

    @Mock
    private TtsVoicePreviewRateLimiter previewRateLimiter;

    private TtsVoiceService service;

    private final UUID userId = UUID.randomUUID();
    private final UUID providerId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new TtsVoiceServiceImpl(
                ttsVoiceRepository,
                userAiProviderRepository,
                platformAiProviderRepository,
                cryptoService,
                aiGatewayClient,
                mediaStorageService,
                previewRateLimiter,
                new AppProperties(null, null, null, null, null, null)
        );
    }

    @Test
    void testListUserVoicesWithoutLanguageFilter() {
        when(userAiProviderRepository.findByIdAndUserId(providerId, userId))
                .thenReturn(Optional.of(new UserAiProvider()));

        TtsVoice v1 = new TtsVoice();
        v1.setId(UUID.randomUUID());
        v1.setVoiceId("voice-1");
        v1.setLanguage("en");

        TtsVoice v2 = new TtsVoice();
        v2.setId(UUID.randomUUID());
        v2.setVoiceId("voice-2");
        v2.setLanguage("vi");

        when(ttsVoiceRepository.findByUserProviderIdAndIsActiveTrue(providerId))
                .thenReturn(List.of(v1, v2));

        List<TtsVoiceResponse> voices = service.listUserVoices(userId, providerId, null);
        assertEquals(2, voices.size());
    }

    @Test
    void testListUserVoicesWithLanguageFilter() {
        when(userAiProviderRepository.findByIdAndUserId(providerId, userId))
                .thenReturn(Optional.of(new UserAiProvider()));

        TtsVoice v1 = new TtsVoice();
        v1.setId(UUID.randomUUID());
        v1.setVoiceId("voice-en");
        v1.setLanguage("en");
        v1.setLanguages(List.of("en"));

        TtsVoice v2 = new TtsVoice();
        v2.setId(UUID.randomUUID());
        v2.setVoiceId("voice-vi");
        v2.setLanguage("vi");
        v2.setLanguages(List.of("vi", "en"));

        when(ttsVoiceRepository.findByUserProviderIdAndIsActiveTrue(providerId))
                .thenReturn(List.of(v1, v2));

        List<TtsVoiceResponse> viVoices = service.listUserVoices(userId, providerId, "vi");
        assertEquals(1, viVoices.size());
        assertEquals("voice-vi", viVoices.get(0).voiceId());

        List<TtsVoiceResponse> enVoices = service.listUserVoices(userId, providerId, "en");
        assertEquals(2, enVoices.size()); // v2 also supports en via languages array
        assertTrue(enVoices.stream().anyMatch(v -> v.voiceId().equals("voice-vi")));
    }

    @Test
    void testListPlatformVoicesFiltersUsingPrimaryLanguageAndLanguagesArray() {
        TtsVoice regional = new TtsVoice();
        regional.setId(UUID.randomUUID());
        regional.setProviderSource("PLATFORM");
        regional.setVoiceId("regional-en");
        regional.setLanguage("en-US");

        TtsVoice multilingual = new TtsVoice();
        multilingual.setId(UUID.randomUUID());
        multilingual.setProviderSource("PLATFORM");
        multilingual.setVoiceId("multilingual");
        multilingual.setLanguage("vi");
        multilingual.setLanguages(List.of("vi", "en"));

        when(ttsVoiceRepository.findByProviderSourceAndIsActiveTrue("PLATFORM"))
                .thenReturn(List.of(regional, multilingual));

        List<TtsVoiceResponse> voices = service.listPlatformVoices("en", "PLATFORM");

        assertEquals(List.of("regional-en", "multilingual"), voices.stream().map(TtsVoiceResponse::voiceId).toList());
    }

    @Test
    void testRefreshUserVoicesNonTtsCapabilityThrows() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setCapabilities(List.of("TRANSLATE")); // No TTS

        when(userAiProviderRepository.findByIdAndUserId(providerId, userId))
                .thenReturn(Optional.of(provider));

        AppException ex = assertThrows(AppException.class, () -> service.refreshUserVoices(userId, providerId));
        assertEquals(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED, ex.getErrorCode());
        verifyNoInteractions(aiGatewayClient);
    }

    @Test
    void testRefreshUserVoicesSuccess() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setProtocol("openai_compatible");
        provider.setBaseUrl("https://api.openai.com/v1");
        provider.setCapabilities(List.of("TTS"));
        provider.setApiKeyEnc(new byte[]{1, 2, 3});

        when(userAiProviderRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));
        when(cryptoService.decrypt(provider.getApiKeyEnc())).thenReturn("sk-test-key");

        AiGatewayClient.DiscoveredVoice dv = new AiGatewayClient.DiscoveredVoice(
                "alloy", "en", List.of("en", "vi"), "UNKNOWN", "Alloy"
        );
        when(aiGatewayClient.fetchTtsVoices("openai_compatible", "https://api.openai.com/v1", "sk-test-key", null))
                .thenReturn(List.of(dv));

        when(ttsVoiceRepository.save(any(TtsVoice.class))).thenAnswer(i -> {
            TtsVoice v = i.getArgument(0);
            v.setId(UUID.randomUUID());
            return v;
        });

        List<TtsVoiceResponse> refreshed = service.refreshUserVoices(userId, providerId);

        verify(ttsVoiceRepository).deleteByUserProviderId(providerId);
        assertEquals(1, refreshed.size());
        assertEquals("alloy", refreshed.get(0).voiceId());
        assertEquals("en", refreshed.get(0).language());
        assertEquals("USER", refreshed.get(0).providerSource());
    }

    @Test
    void testListPlatformVoices() {
        TtsVoice pv = new TtsVoice();
        pv.setId(UUID.randomUUID());
        pv.setProviderSource("PLATFORM");
        pv.setVoiceId("echo");
        pv.setLanguage("en");
        pv.setLanguages(List.of("en"));

        when(ttsVoiceRepository.findByProviderSourceAndIsActiveTrue("PLATFORM"))
                .thenReturn(List.of(pv));

        List<TtsVoiceResponse> voices = service.listPlatformVoices(null, "PLATFORM");
        assertEquals(1, voices.size());
        assertEquals("echo", voices.get(0).voiceId());
    }

    // ── POST /api/tts-voices/preview ─────────────────────────────────────────

    private TtsVoice platformVoice(UUID platformProviderId) {
        TtsVoice v = new TtsVoice();
        v.setId(UUID.randomUUID());
        v.setProviderSource("PLATFORM");
        v.setPlatformProviderId(platformProviderId);
        v.setVoiceId("alloy");
        v.setLanguage("en");
        v.setActive(true);
        return v;
    }

    private PlatformAiProvider platformProvider() {
        PlatformAiProvider p = new PlatformAiProvider();
        p.setId(UUID.randomUUID());
        p.setProtocol("openai_compatible");
        p.setBaseUrl("https://api.openai.com/v1");
        p.setCapabilities(List.of("TTS"));
        p.setApiKeyEnc(new byte[]{1, 2, 3});
        p.setDefaultModel("gpt-4o-mini-tts");
        p.setActive(true);
        return p;
    }

    @Test
    void testPreviewVoiceNotFound() {
        UUID voiceId = UUID.randomUUID();
        when(ttsVoiceRepository.findById(voiceId)).thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class,
                () -> service.previewVoice(userId, new PreviewTtsVoiceRequest(voiceId, "Xin chào")));
        assertEquals(ErrorCode.TTS_VOICE_NOT_FOUND, ex.getErrorCode());
        verifyNoInteractions(aiGatewayClient, mediaStorageService);
    }

    @Test
    void testPreviewVoiceInactiveNotFound() {
        TtsVoice v = platformVoice(UUID.randomUUID());
        v.setActive(false);
        when(ttsVoiceRepository.findById(v.getId())).thenReturn(Optional.of(v));

        AppException ex = assertThrows(AppException.class,
                () -> service.previewVoice(userId, new PreviewTtsVoiceRequest(v.getId(), "Xin chào")));
        assertEquals(ErrorCode.TTS_VOICE_NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void testPreviewUserVoiceOfOtherUserNotFound() {
        TtsVoice v = new TtsVoice();
        v.setId(UUID.randomUUID());
        v.setProviderSource("USER");
        v.setUserProviderId(providerId);
        v.setVoiceId("my-voice");
        v.setLanguage("vi");
        v.setActive(true);
        when(ttsVoiceRepository.findById(v.getId())).thenReturn(Optional.of(v));
        // provider belongs to another user -> findByIdAndUserId misses
        when(userAiProviderRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class,
                () -> service.previewVoice(userId, new PreviewTtsVoiceRequest(v.getId(), "Xin chào")));
        assertEquals(ErrorCode.TTS_VOICE_NOT_FOUND, ex.getErrorCode());
        verifyNoInteractions(aiGatewayClient, mediaStorageService);
    }

    @Test
    void testPreviewRateLimited() {
        PlatformAiProvider p = platformProvider();
        TtsVoice v = platformVoice(p.getId());
        when(ttsVoiceRepository.findById(v.getId())).thenReturn(Optional.of(v));
        when(platformAiProviderRepository.findById(p.getId())).thenReturn(Optional.of(p));
        when(cryptoService.decrypt(p.getApiKeyEnc())).thenReturn("sk-platform");
        doThrow(new AppException(ErrorCode.TTS_PREVIEW_RATE_LIMIT_EXCEEDED))
                .when(previewRateLimiter).check(userId);

        AppException ex = assertThrows(AppException.class,
                () -> service.previewVoice(userId, new PreviewTtsVoiceRequest(v.getId(), "Xin chào")));
        assertEquals(ErrorCode.TTS_PREVIEW_RATE_LIMIT_EXCEEDED, ex.getErrorCode());
        verifyNoInteractions(aiGatewayClient, mediaStorageService);
    }

    @Test
    void testPreviewProviderReturnedNoAudio() {
        PlatformAiProvider p = platformProvider();
        TtsVoice v = platformVoice(p.getId());
        when(ttsVoiceRepository.findById(v.getId())).thenReturn(Optional.of(v));
        when(platformAiProviderRepository.findById(p.getId())).thenReturn(Optional.of(p));
        when(cryptoService.decrypt(p.getApiKeyEnc())).thenReturn("sk-platform");
        when(aiGatewayClient.synthesizeTtsPreview(
                eq("openai_compatible"), eq("https://api.openai.com/v1"), eq("sk-platform"),
                eq("gpt-4o-mini-tts"), eq("alloy"), eq("Xin chào")))
                .thenReturn(null);

        AppException ex = assertThrows(AppException.class,
                () -> service.previewVoice(userId, new PreviewTtsVoiceRequest(v.getId(), "Xin chào")));
        assertEquals(ErrorCode.TTS_PREVIEW_FAILED, ex.getErrorCode());
        verifyNoInteractions(mediaStorageService);
    }

    @Test
    void testPreviewSuccess() {
        PlatformAiProvider p = platformProvider();
        TtsVoice v = platformVoice(p.getId());
        when(ttsVoiceRepository.findById(v.getId())).thenReturn(Optional.of(v));
        when(platformAiProviderRepository.findById(p.getId())).thenReturn(Optional.of(p));
        when(cryptoService.decrypt(p.getApiKeyEnc())).thenReturn("sk-platform");

        byte[] fakeMp3 = new byte[]{0x49, 0x44, 0x33, 0x04, 0x00}; // "ID3" header
        when(aiGatewayClient.synthesizeTtsPreview(anyString(), anyString(), anyString(), anyString(),
                eq("alloy"), eq("Xin chào")))
                .thenReturn(Base64.getEncoder().encodeToString(fakeMp3));
        when(mediaStorageService.mediaBucket()).thenReturn("transflow-media");
        when(mediaStorageService.presignedGetUrl(anyString())).thenReturn("http://minio/presigned-url");

        PreviewTtsVoiceResponse res = service.previewVoice(userId, new PreviewTtsVoiceRequest(v.getId(), " Xin chào "));

        assertEquals("http://minio/presigned-url", res.audioUrl());
        assertEquals(3600, res.expiresInSeconds());
        verify(previewRateLimiter).check(userId);
        verify(mediaStorageService).putMediaObject(
                argThat(k -> k.startsWith("temp/voice-preview/" + userId + "/") && k.endsWith(".mp3")),
                any(), eq((long) fakeMp3.length), eq("audio/mpeg"));
        verify(mediaStorageService).presignedGetUrl(argThat(ref -> ref.startsWith("transflow-media/temp/voice-preview/")));
    }
}
