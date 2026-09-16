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
import com.app.modules.provider.repository.TtsVoiceRepository;
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
        verify(providerRepository).save(any(UserAiProvider.class));
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
        verify(providerRepository).delete(provider);
    }

    @Test
    void testTestProviderSuccess() {
        UserAiProvider provider = new UserAiProvider();
        provider.setId(providerId);
        provider.setUserId(userId);
        provider.setProtocol("openai_compatible");
        provider.setBaseUrl("https://api.openai.com/v1");
        provider.setApiKeyEnc(new byte[]{1, 2, 3});

        when(providerRepository.findByIdAndUserId(providerId, userId)).thenReturn(Optional.of(provider));
        when(cryptoService.decrypt(provider.getApiKeyEnc())).thenReturn("sk-decrypted-key");
        when(aiGatewayClient.testConnection("openai_compatible", "https://api.openai.com/v1", "sk-decrypted-key"))
                .thenReturn(true);

        TestConnectionResponse resp = service.testProvider(userId, providerId);
        assertTrue(resp.success());
    }
}
