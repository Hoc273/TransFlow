package com.app.modules.provider.service;

import com.app.common.crypto.CryptoService;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.entity.UserAiProvider;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.repository.UserAiProviderRepository;
import com.app.modules.provider.service.impl.ProviderResolverServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ProviderResolverServiceTest {

    @Mock
    private UserAiProviderRepository userAiProviderRepository;

    @Mock
    private PlatformAiProviderRepository platformAiProviderRepository;

    @Mock
    private TtsVoiceRepository ttsVoiceRepository;

    @Mock
    private CryptoService cryptoService;

    private ProviderResolverService service;

    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new ProviderResolverServiceImpl(
                userAiProviderRepository,
                platformAiProviderRepository,
                ttsVoiceRepository,
                cryptoService
        );
    }

    @Test
    void testResolveForCapabilityUserByokPrecedence() {
        UserAiProvider userProvider = new UserAiProvider();
        userProvider.setId(UUID.randomUUID());
        userProvider.setUserId(userId);
        userProvider.setProtocol("anthropic");
        userProvider.setCapabilities(List.of("TRANSLATE", "STT"));
        userProvider.setBaseUrl("https://api.anthropic.com");
        userProvider.setApiKeyEnc(new byte[]{1, 2, 3});
        userProvider.setActive(true);

        when(userAiProviderRepository.findByUserIdAndIsActiveTrue(userId))
                .thenReturn(List.of(userProvider));
        when(cryptoService.decrypt(userProvider.getApiKeyEnc())).thenReturn("sk-user-decrypted-key");

        ProviderResolverService.ProviderResolution res = service.resolveForCapability(userId, "TRANSLATE");

        assertNotNull(res);
        assertEquals("anthropic", res.providerType());
        assertEquals("sk-user-decrypted-key", res.apiKey());
        assertEquals("https://api.anthropic.com", res.endpointUrl());
        assertTrue(res.isPersonalApiKey(), "User BYOK provider must result in isPersonalApiKey = true");
        verifyNoInteractions(platformAiProviderRepository);
    }

    @Test
    void testResolveForCapabilityPlatformFallback() {
        // User has no active provider
        when(userAiProviderRepository.findByUserIdAndIsActiveTrue(userId))
                .thenReturn(List.of());

        PlatformAiProvider platformProvider = new PlatformAiProvider();
        platformProvider.setId(UUID.randomUUID());
        platformProvider.setProtocol("openai_compatible");
        platformProvider.setCapabilities(List.of("TTS", "TRANSLATE"));
        platformProvider.setBaseUrl("https://api.openai.com/v1");
        platformProvider.setApiKeyEnc(new byte[]{7, 8, 9});
        platformProvider.setActive(true);

        when(platformAiProviderRepository.findByIsActiveTrue())
                .thenReturn(List.of(platformProvider));
        when(cryptoService.decrypt(platformProvider.getApiKeyEnc())).thenReturn("sk-platform-decrypted-key");

        ProviderResolverService.ProviderResolution res = service.resolveForCapability(userId, "TTS");

        assertNotNull(res);
        assertEquals("openai_compatible", res.providerType());
        assertEquals("sk-platform-decrypted-key", res.apiKey());
        assertEquals("https://api.openai.com/v1", res.endpointUrl());
        assertFalse(res.isPersonalApiKey(), "Platform fallback must result in isPersonalApiKey = false");
    }

    @Test
    void testResolveForCapabilityNoProviderConfiguredThrows() {
        when(userAiProviderRepository.findByUserIdAndIsActiveTrue(userId)).thenReturn(List.of());
        when(platformAiProviderRepository.findByIsActiveTrue()).thenReturn(List.of());

        AppException ex = assertThrows(AppException.class, () -> service.resolveForCapability(userId, "VISION"));
        assertEquals(ErrorCode.PLATFORM_PROVIDER_NOT_CONFIGURED, ex.getErrorCode());
    }

    @Test
    void testResolveVoiceLanguage() {
        UUID voiceId = UUID.randomUUID();
        TtsVoice voice = new TtsVoice();
        voice.setId(voiceId);
        voice.setLanguage("vi");

        when(ttsVoiceRepository.findById(voiceId)).thenReturn(Optional.of(voice));

        Optional<String> lang = service.resolveVoiceLanguage(voiceId);
        assertTrue(lang.isPresent());
        assertEquals("vi", lang.get());
    }
}
