package com.app.modules.provider.service;

import com.app.common.crypto.CryptoService;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.dto.CreateUserAiProviderRequest;
import com.app.modules.provider.dto.TestConnectionResponse;
import com.app.modules.provider.dto.UpdateUserAiProviderRequest;
import com.app.modules.provider.dto.UserAiProviderResponse;
import com.app.modules.provider.entity.UserAiProvider;
import com.app.modules.provider.entity.UserAiProviderDefault;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.repository.UserAiProviderDefaultRepository;
import com.app.modules.provider.repository.UserAiProviderRepository;
import com.app.modules.provider.service.impl.UserAiProviderServiceImpl;
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
class UserAiProviderServiceTest {

    @Mock
    private UserAiProviderRepository providerRepository;

    @Mock
    private TtsVoiceRepository ttsVoiceRepository;

    @Mock
    private UserAiProviderDefaultRepository providerDefaultRepository;

    @Mock
    private CryptoService cryptoService;

    @Mock
    private AiGatewayClient aiGatewayClient;

    private UserAiProviderService service;

    private final UUID userId = UUID.randomUUID();
    private final UUID providerId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new UserAiProviderServiceImpl(
                providerRepository,
                ttsVoiceRepository,
                providerDefaultRepository,
                cryptoService,
                aiGatewayClient
        );
    }

    @Test
    void testCreateProviderSuccess() {
        CreateUserAiProviderRequest req = new CreateUserAiProviderRequest(
                "openai_compatible",
                List.of("TRANSLATE", "TTS"),
                "https://api.openai.com/v1",
                "sk-secret-key-12345",
                "gpt-4o"
        );

        byte[] fakeEnc = new byte[]{1, 2, 3};
        when(cryptoService.encrypt(req.apiKey())).thenReturn(fakeEnc);

        when(providerRepository.save(any(UserAiProvider.class))).thenAnswer(invocation -> {
            UserAiProvider saved = invocation.getArgument(0);
            saved.setId(providerId);
            return saved;
        });

        UserAiProviderResponse resp = service.createProvider(userId, req);

        assertNotNull(resp);
        assertEquals(providerId, resp.id());
        assertEquals(userId, resp.userId());
        assertEquals("openai_compatible", resp.protocol());
        assertEquals(List.of("TRANSLATE", "TTS"), resp.capabilities());
        assertEquals("https://api.openai.com/v1", resp.baseUrl());
        assertTrue(resp.isActive());
        assertEquals(List.of(), resp.defaultForCapabilities());
        verify(providerRepository).save(any(UserAiProvider.class));
    }

    @Test
    void createProviderSetsDefaultForRequestedCapability() {
        CreateUserAiProviderRequest req = new CreateUserAiProviderRequest(
                "dashscope_native", List.of("TRANSLATE", "STT"), "https://dashscope.example",
                "sk-secret", "qwen-plus", List.of("TRANSLATE"));
        when(cryptoService.encrypt(req.apiKey())).thenReturn(new byte[]{1, 2, 3});
        when(providerRepository.save(any(UserAiProvider.class))).thenAnswer(invocation -> {
            UserAiProvider provider = invocation.getArgument(0);
            provider.setId(providerId);
            return provider;
        });
        when(providerDefaultRepository.findForCapability(userId, "TRANSLATE")).thenReturn(Optional.empty());

        UserAiProviderResponse response = service.createProvider(userId, req);

        assertEquals(List.of("TRANSLATE"), response.defaultForCapabilities());
        verify(providerDefaultRepository).save(argThat(mapping ->
                mapping.getId().getUserId().equals(userId)
                        && mapping.getId().getCapability().equals("TRANSLATE")
                        && mapping.getProviderId().equals(providerId)));
    }

    @Test
    void listProvidersReturnsCapabilityDefaults() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setProtocol("dashscope_native");
        provider.setCapabilities(List.of("TRANSLATE", "STT"));
        provider.setBaseUrl("https://dashscope.example");
        provider.setDefaultModel("qwen-plus");
        provider.setActive(true);
        when(providerDefaultRepository.findAllForUser(userId)).thenReturn(List.of(
                new UserAiProviderDefault(userId, "TRANSLATE", providerId)));
        when(providerRepository.findByUserIdOrderByCreatedAtDesc(userId)).thenReturn(List.of(provider));

        List<UserAiProviderResponse> response = service.listProviders(userId);

        assertEquals(1, response.size());
        assertEquals(List.of("TRANSLATE"), response.get(0).defaultForCapabilities());
    }

    @Test
    void testCreateProviderInvalidProtocolThrows() {
        CreateUserAiProviderRequest req = new CreateUserAiProviderRequest(
                "unsupported_protocol",
                List.of("TRANSLATE"),
                "https://api.openai.com/v1",
                "sk-secret",
                null
        );

        AppException ex = assertThrows(AppException.class, () -> service.createProvider(userId, req));
        assertEquals(ErrorCode.INVALID_PROVIDER_PROTOCOL, ex.getErrorCode());
        verifyNoInteractions(providerRepository);
    }

    @Test
    void createRejectsCapabilityTheProtocolAdapterCannotRun() {
        // Anthropic / Azure adapters have no TTS / STT path: saving used to succeed and the
        // media job failed later with PROVIDER_UNSUPPORTED_CAPABILITY.
        for (var combo : List.of(
                List.of("anthropic", "TTS"),
                List.of("azure_speech", "STT"),
                List.of("google_speech", "TRANSLATE"),
                List.of("elevenlabs_native", "VISION"))) {
            CreateUserAiProviderRequest req = new CreateUserAiProviderRequest(
                    combo.get(0), List.of(combo.get(1)), "https://api.example.test", "sk-secret", "m");
            AppException ex = assertThrows(AppException.class, () -> service.createProvider(userId, req));
            assertEquals(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED, ex.getErrorCode(), combo.toString());
        }
        verifyNoInteractions(providerRepository);
    }

    @Test
    void testGetProviderSuccess() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setProtocol("anthropic");
        provider.setCapabilities(List.of("TRANSLATE"));
        provider.setBaseUrl("https://api.anthropic.com");
        provider.setApiKeyHint("sk-...cdef");
        provider.setActive(true);

        when(providerRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));

        UserAiProviderResponse resp = service.getProvider(userId, providerId);
        assertNotNull(resp);
        assertEquals(providerId, resp.id());
        assertEquals("anthropic", resp.protocol());
    }

    @Test
    void testGetProviderNotFoundThrows() {
        when(providerRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class, () -> service.getProvider(userId, providerId));
        assertEquals(ErrorCode.PROVIDER_NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void testUpdateProviderSuccess() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setProtocol("openai_compatible");
        provider.setCapabilities(List.of("STT"));
        provider.setBaseUrl("https://old.url");
        provider.setActive(true);

        when(providerRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));
        when(cryptoService.encrypt("sk-new-key-12345")).thenReturn(new byte[]{4, 5, 6});
        when(providerRepository.save(any(UserAiProvider.class))).thenAnswer(i -> i.getArgument(0));

        UpdateUserAiProviderRequest req = new UpdateUserAiProviderRequest(
                "openai_compatible",
                List.of("STT", "TTS"),
                "https://new.url",
                "sk-new-key-12345",
                "whisper-1",
                true
        );

        UserAiProviderResponse resp = service.updateProvider(userId, providerId, req);
        assertNotNull(resp);
        assertEquals("https://new.url", resp.baseUrl());
        assertEquals(List.of("STT", "TTS"), resp.capabilities());
        assertEquals("whisper-1", resp.defaultModel());
    }

    @Test
    void testDeleteProviderCascadesVoices() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);

        when(providerRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));

        service.deleteProvider(userId, providerId);

        verify(ttsVoiceRepository).deleteByUserProviderId(providerId);
        verify(providerDefaultRepository).deleteForProvider(providerId);
        verify(providerRepository).delete(provider);
    }

    @Test
    void testTestProviderSuccess() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setProtocol("openai_compatible");
        provider.setCapabilities(List.of("TRANSLATE"));
        provider.setBaseUrl("https://api.openai.com/v1");
        provider.setApiKeyEnc(new byte[]{1, 2, 3});
        provider.setDefaultModel("gpt-4o-mini");

        when(providerRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));
        when(cryptoService.decrypt(provider.getApiKeyEnc())).thenReturn("sk-decrypted-key");
        when(aiGatewayClient.testConnection("openai_compatible", "https://api.openai.com/v1", "sk-decrypted-key"))
                .thenReturn(true);
        when(aiGatewayClient.probeCapability("openai_compatible", "https://api.openai.com/v1",
                "sk-decrypted-key", "gpt-4o-mini", "TRANSLATE"))
                .thenReturn(new AiGatewayClient.ProviderCapabilityProbe(true, "gpt-4o-mini", null, "ok"));

        TestConnectionResponse resp = service.testProvider(userId, providerId, "TRANSLATE");
        assertTrue(resp.success());
        assertEquals("TRANSLATE", resp.capabilityResults().get(0).capability());
        assertEquals("gpt-4o-mini", resp.capabilityResults().get(0).model());
    }

    @Test
    void testProviderUsesTranslateAliasAndReportsAuthSeparatelyFromModelProbe() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setProtocol("openai_compatible");
        provider.setCapabilities(List.of("TRANSLATE"));
        provider.setBaseUrl("https://api.openai.com/v1");
        provider.setApiKeyEnc(new byte[]{1, 2, 3});
        provider.setDefaultModel("gpt-4o-mini");
        when(providerRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));
        when(cryptoService.decrypt(provider.getApiKeyEnc())).thenReturn("sk-decrypted-key");
        when(aiGatewayClient.testConnection("openai_compatible", "https://api.openai.com/v1", "sk-decrypted-key"))
                .thenReturn(false);
        when(aiGatewayClient.probeCapability("openai_compatible", "https://api.openai.com/v1",
                "sk-decrypted-key", "gpt-4o-mini", "TRANSLATE"))
                .thenReturn(new AiGatewayClient.ProviderCapabilityProbe(true, "gpt-4o-mini", null, "ok"));

        TestConnectionResponse response = service.testProvider(userId, providerId, "TEXT");

        assertFalse(response.success());
        assertFalse(response.authSuccess());
        assertEquals("TRANSLATE", response.capabilityResults().get(0).capability());
        assertFalse(response.capabilityResults().get(0).success());
        assertEquals("PROVIDER_AUTH_FAILED", response.capabilityResults().get(0).errorCode());
        verify(aiGatewayClient).probeCapability("openai_compatible", "https://api.openai.com/v1",
                "sk-decrypted-key", "gpt-4o-mini", "TRANSLATE");
    }

    @Test
    void updatingDefaultForCapabilityReplacesPriorProviderMapping() {
        UUID priorProviderId = UUID.randomUUID();
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setProtocol("dashscope_native");
        provider.setCapabilities(List.of("TRANSLATE"));
        provider.setBaseUrl("https://dashscope.example");
        provider.setActive(true);
        UserAiProviderDefault existing = new UserAiProviderDefault(userId, "TRANSLATE", priorProviderId);

        when(providerRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));
        when(providerRepository.save(any(UserAiProvider.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(providerDefaultRepository.findByProviderId(providerId)).thenReturn(List.of());
        when(providerDefaultRepository.findForCapability(userId, "TRANSLATE")).thenReturn(Optional.of(existing));
        when(providerDefaultRepository.findByProviderId(providerId)).thenAnswer(invocation ->
                providerId.equals(existing.getProviderId()) ? List.of(existing) : List.of());

        UpdateUserAiProviderRequest request = new UpdateUserAiProviderRequest(
                null, null, null, null, "qwen-plus", null, List.of("TRANSLATE"));
        UserAiProviderResponse response = service.updateProvider(userId, providerId, request);

        assertEquals(providerId, existing.getProviderId());
        assertEquals(List.of("TRANSLATE"), response.defaultForCapabilities());
        verify(providerDefaultRepository).save(existing);
    }

    @Test
    void deactivatingProviderClearsEchoedCapabilityDefaults() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setProtocol("dashscope_native");
        provider.setCapabilities(List.of("TRANSLATE"));
        provider.setBaseUrl("https://dashscope.example");
        provider.setDefaultModel("qwen-plus");
        provider.setActive(true);
        UserAiProviderDefault mapping = new UserAiProviderDefault(userId, "TRANSLATE", providerId);

        when(providerRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));
        when(providerRepository.save(any(UserAiProvider.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(providerDefaultRepository.findByProviderId(providerId)).thenReturn(List.of(mapping), List.of());

        UserAiProviderResponse response = service.updateProvider(userId, providerId,
                new UpdateUserAiProviderRequest(null, null, null, null, null, false,
                        List.of("TRANSLATE")));

        assertFalse(response.isActive());
        assertEquals(List.of(), response.defaultForCapabilities());
        verify(providerDefaultRepository).deleteForCapability(userId, "TRANSLATE");
    }
}
