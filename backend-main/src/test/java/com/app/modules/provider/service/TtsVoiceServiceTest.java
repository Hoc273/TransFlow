package com.app.modules.provider.service;

import com.app.common.crypto.CryptoService;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.dto.TtsVoicePreviewRequest;
import com.app.modules.provider.dto.TtsVoicePreviewResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.entity.UserAiProvider;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.repository.UserAiProviderRepository;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.provider.service.impl.TtsVoiceServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TtsVoiceServiceTest {

    @Mock
    private TtsVoiceRepository ttsVoiceRepository;

    @Mock
    private UserAiProviderRepository userAiProviderRepository;

    @Mock
    private CryptoService cryptoService;

    @Mock
    private AiGatewayClient aiGatewayClient;

    @Mock
    private ProviderResolverService providerResolverService;

    @Mock
    private TtsPreviewRateLimiter ttsPreviewRateLimiter;

    @Mock
    private MediaStorageService mediaStorageService;

    private TtsVoiceService service;

    private final UUID userId = UUID.randomUUID();
    private final UUID providerId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new TtsVoiceServiceImpl(
                ttsVoiceRepository,
                userAiProviderRepository,
                cryptoService,
                aiGatewayClient,
                providerResolverService,
                ttsPreviewRateLimiter,
                mediaStorageService
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
    void testPreviewVoiceSuccess() {
        UUID voiceId = UUID.randomUUID();
        ProviderResolverService.TtsVoiceResolution resolution =
                new ProviderResolverService.TtsVoiceResolution(
                        "alloy", "openai_compatible", "https://api.openai.com/v1",
                        "sk-test-key", "tts-1", false);
        when(providerResolverService.resolveForTtsVoice(userId, voiceId)).thenReturn(resolution);
        when(aiGatewayClient.synthesizeTts(
                eq("openai_compatible"), eq("https://api.openai.com/v1"), eq("sk-test-key"),
                eq("tts-1"), eq("alloy"), eq("Xin chào"), anyString()))
                .thenReturn(new byte[]{1, 2, 3});
        when(mediaStorageService.mediaBucket()).thenReturn("transflow-media");
        when(mediaStorageService.presignedGetUrl(startsWith("transflow-media/previews/tts/")))
                .thenReturn("http://minio:9000/transflow-media/previews/tts/x.mp3?sig=1");

        TtsVoicePreviewResponse res = service.previewVoice(userId,
                new TtsVoicePreviewRequest(voiceId, "Xin chào"));

        assertEquals("http://minio:9000/transflow-media/previews/tts/x.mp3?sig=1", res.audioUrl());
        verify(mediaStorageService).putMediaObject(
                startsWith("previews/tts/" + userId + "/"), any(), eq(3L), eq("audio/mpeg"));
    }

    @Test
    void testPreviewVoiceRateLimited() {
        when(ttsPreviewRateLimiter.isRateLimited(userId)).thenReturn(true);

        AppException ex = assertThrows(AppException.class,
                () -> service.previewVoice(userId, new TtsVoicePreviewRequest(UUID.randomUUID(), "hi")));
        assertEquals(ErrorCode.TTS_PREVIEW_RATE_LIMIT_EXCEEDED, ex.getErrorCode());
        verifyNoInteractions(providerResolverService, aiGatewayClient, mediaStorageService);
    }

    @Test
    void testPreviewVoiceSynthesisFailurePropagates() {
        UUID voiceId = UUID.randomUUID();
        when(providerResolverService.resolveForTtsVoice(userId, voiceId))
                .thenReturn(new ProviderResolverService.TtsVoiceResolution(
                        "alloy", "openai_compatible", "https://api.openai.com/v1",
                        "sk-test-key", "tts-1", false));
        when(aiGatewayClient.synthesizeTts(any(), any(), any(), any(), any(), any(), anyString()))
                .thenThrow(new AppException(ErrorCode.TTS_PREVIEW_FAILED));

        AppException ex = assertThrows(AppException.class,
                () -> service.previewVoice(userId, new TtsVoicePreviewRequest(voiceId, "hi")));
        assertEquals(ErrorCode.TTS_PREVIEW_FAILED, ex.getErrorCode());
        verifyNoInteractions(mediaStorageService);
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
}
