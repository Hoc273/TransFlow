package com.app.modules.provider.service;

import com.app.common.crypto.CryptoService;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.entity.UserAiProvider;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.repository.UserAiProviderDefaultRepository;
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
    private UserAiProviderDefaultRepository userAiProviderDefaultRepository;

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
                userAiProviderDefaultRepository,
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
        userProvider.setDefaultModel("claude-3-5-sonnet");
        userProvider.setActive(true);

        when(userAiProviderRepository.findByUserIdAndIsActiveTrue(userId))
                .thenReturn(List.of(userProvider));
        when(cryptoService.decrypt(userProvider.getApiKeyEnc())).thenReturn("sk-user-decrypted-key");

        ProviderResolverService.ProviderResolution res = service.resolveForCapability(userId, "TRANSLATE");

        assertNotNull(res);
        assertEquals("anthropic", res.providerType());
        assertEquals("sk-user-decrypted-key", res.apiKey());
        assertEquals("https://api.anthropic.com", res.baseUrl());
        assertEquals("claude-3-5-sonnet", res.model());
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
        platformProvider.setDefaultModel("gpt-4o-mini");
        platformProvider.setActive(true);

        when(platformAiProviderRepository.findByIsActiveTrue())
                .thenReturn(List.of(platformProvider));
        when(cryptoService.decrypt(platformProvider.getApiKeyEnc())).thenReturn("sk-platform-decrypted-key");

        ProviderResolverService.ProviderResolution res = service.resolveForCapability(userId, "TTS");

        assertNotNull(res);
        assertEquals("openai_compatible", res.providerType());
        assertEquals("sk-platform-decrypted-key", res.apiKey());
        assertEquals("https://api.openai.com/v1", res.baseUrl());
        assertEquals("gpt-4o-mini", res.model());
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
        UUID providerId = UUID.randomUUID();
        UUID voiceId = UUID.randomUUID();
        TtsVoice voice = new TtsVoice();
        voice.setId(voiceId);
        voice.setProviderSource("USER");
        voice.setUserProviderId(providerId);
        voice.setLanguage("vi");
        voice.setActive(true);
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setCapabilities(List.of("TTS"));
        provider.setActive(true);

        when(ttsVoiceRepository.findById(voiceId)).thenReturn(Optional.of(voice));
        when(userAiProviderRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));

        Optional<String> lang = service.resolveVoiceLanguage(userId, providerId, voiceId);
        assertTrue(lang.isPresent());
        assertEquals("vi", lang.get());
    }

    @Test
    void testResolveVoiceLanguageRejectsMismatchedProvider() {
        UUID ownerProviderId = UUID.randomUUID();
        UUID requestedProviderId = UUID.randomUUID();
        UUID voiceId = UUID.randomUUID();
        TtsVoice voice = new TtsVoice();
        voice.setId(voiceId);
        voice.setProviderSource("USER");
        voice.setUserProviderId(ownerProviderId);
        voice.setLanguage("vi");
        voice.setActive(true);
        when(ttsVoiceRepository.findById(voiceId)).thenReturn(Optional.of(voice));

        assertTrue(service.resolveVoiceLanguage(userId, requestedProviderId, voiceId).isEmpty());
        verifyNoInteractions(userAiProviderRepository, platformAiProviderRepository);
    }

    @Test
    void explicitDefaultWinsRegardlessOfRepositoryOrderAndUsesItsModel() {
        UserAiProvider providerA = personalProvider("qwen-plus");
        UserAiProvider providerB = personalProvider("qwen-max");
        providerA.setProtocol("dashscope_native");
        providerB.setProtocol("dashscope_native");
        when(userAiProviderRepository.findByUserIdAndIsActiveTrue(userId)).thenReturn(List.of(providerA, providerB));
        when(userAiProviderDefaultRepository.findForCapability(userId, "TRANSLATE"))
                .thenReturn(Optional.of(new com.app.modules.provider.entity.UserAiProviderDefault(
                        userId, "TRANSLATE", providerB.getId())));
        when(userAiProviderRepository.findByIdAndUserId(providerB.getId(), userId)).thenReturn(Optional.of(providerB));
        when(cryptoService.decrypt(providerB.getApiKeyEnc())).thenReturn("key-b");

        ProviderResolverService.ProviderResolution resolution = service.resolveForCapability(userId, "TRANSLATE");

        assertEquals(providerB.getId(), resolution.providerId());
        assertEquals("qwen-max", resolution.model());
        assertEquals("key-b", resolution.apiKey());
        verify(cryptoService, times(1)).decrypt(any(byte[].class));
    }

    @Test
    void multiplePersonalCandidatesWithoutDefaultFailBeforePlatformFallback() {
        when(userAiProviderRepository.findByUserIdAndIsActiveTrue(userId))
                .thenReturn(List.of(personalProvider("model-a"), personalProvider("model-b")));

        AppException ex = assertThrows(AppException.class,
                () -> service.resolveForCapability(userId, "TRANSLATE"));

        assertEquals(ErrorCode.PROVIDER_DEFAULT_NOT_CONFIGURED, ex.getErrorCode());
        verifyNoInteractions(platformAiProviderRepository);
    }

    @Test
    void selectedProviderWithoutConfiguredModelFailsClearly() {
        UserAiProvider provider = personalProvider(" ");
        when(userAiProviderRepository.findByUserIdAndIsActiveTrue(userId)).thenReturn(List.of(provider));

        AppException ex = assertThrows(AppException.class,
                () -> service.resolveForCapability(userId, "TRANSLATE"));

        assertEquals(ErrorCode.PROVIDER_MODEL_NOT_CONFIGURED, ex.getErrorCode());
        verifyNoInteractions(platformAiProviderRepository);
    }

    private UserAiProvider personalProvider(String model) {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(UUID.randomUUID());
        provider.setUserId(userId);
        provider.setProtocol("openai_compatible");
        provider.setCapabilities(List.of("TRANSLATE", "STT"));
        provider.setBaseUrl("https://provider.example/v1");
        provider.setApiKeyEnc(new byte[]{3, 2, 1});
        provider.setDefaultModel(model);
        provider.setActive(true);
        return provider;
    }

    @Test
    void isVoiceLanguageCompatibleAcceptsMultilingualVoiceAndRejectsUnsupportedTarget() {
        UUID providerId = UUID.randomUUID();
        UUID voiceId = UUID.randomUUID();
        TtsVoice voice = ownedVoice(providerId, voiceId);
        voice.setLanguage("vi");
        voice.setLanguages(List.of("vi", "en-US"));
        stubOwnedVoice(providerId, voiceId, voice);

        assertTrue(service.isVoiceLanguageCompatible(userId, providerId, voiceId, "en"));
        assertTrue(service.isVoiceLanguageCompatible(userId, providerId, voiceId, "EN_us"));
        assertFalse(service.isVoiceLanguageCompatible(userId, providerId, voiceId, "fr"));
    }

    @Test
    void isVoiceLanguageCompatibleAcceptsPrimaryLanguageFromVoiceLanguage() {
        UUID providerId = UUID.randomUUID();
        UUID voiceId = UUID.randomUUID();
        TtsVoice voice = ownedVoice(providerId, voiceId);
        voice.setLanguage("en-US");
        stubOwnedVoice(providerId, voiceId, voice);

        assertTrue(service.isVoiceLanguageCompatible(userId, providerId, voiceId, "en"));
    }

    @Test
    void isVoiceLanguageCompatibleDoesNotTreatUnknownOrBlankTagsAsRealLanguages() {
        UUID providerId = UUID.randomUUID();
        UUID voiceId = UUID.randomUUID();
        TtsVoice voice = ownedVoice(providerId, voiceId);
        voice.setLanguage("und");
        voice.setLanguages(List.of("und"));
        stubOwnedVoice(providerId, voiceId, voice);

        assertFalse(service.isVoiceLanguageCompatible(userId, providerId, voiceId, "en"));
        assertFalse(service.isVoiceLanguageCompatible(userId, providerId, voiceId, "und"));
        assertFalse(service.isVoiceLanguageCompatible(userId, providerId, voiceId, "  "));
        assertFalse(service.isVoiceLanguageCompatible(userId, providerId, voiceId, null));
    }

    @Test
    void isVoiceLanguageCompatibleRejectsVoiceFromDifferentProvider() {
        UUID actualProviderId = UUID.randomUUID();
        UUID requestedProviderId = UUID.randomUUID();
        UUID voiceId = UUID.randomUUID();
        TtsVoice voice = ownedVoice(actualProviderId, voiceId);
        voice.setLanguage("en");
        when(ttsVoiceRepository.findById(voiceId)).thenReturn(Optional.of(voice));

        AppException ex = assertThrows(AppException.class, () ->
                service.isVoiceLanguageCompatible(userId, requestedProviderId, voiceId, "en"));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
        verifyNoInteractions(userAiProviderRepository, platformAiProviderRepository);
    }

    private TtsVoice ownedVoice(UUID providerId, UUID voiceId) {
        TtsVoice voice = new TtsVoice();
        voice.setId(voiceId);
        voice.setProviderSource("USER");
        voice.setUserProviderId(providerId);
        voice.setActive(true);
        return voice;
    }

    private void stubOwnedVoice(UUID providerId, UUID voiceId, TtsVoice voice) {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setCapabilities(List.of("TTS"));
        provider.setActive(true);
        when(ttsVoiceRepository.findById(voiceId)).thenReturn(Optional.of(voice));
        when(userAiProviderRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));
    }
}
