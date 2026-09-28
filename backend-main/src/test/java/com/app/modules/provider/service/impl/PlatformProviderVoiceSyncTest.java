package com.app.modules.provider.service.impl;

import com.app.common.crypto.CryptoService;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.dto.CreatePlatformAiProviderRequest;
import com.app.modules.provider.dto.UpdatePlatformAiProviderRequest;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.event.TtsVoiceSyncRequested;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.service.ProviderHealthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** A platform TTS key must bring its voice catalog along — the job voice picker reads only that catalog. */
@ExtendWith(MockitoExtension.class)
class PlatformProviderVoiceSyncTest {

    @Mock private PlatformAiProviderRepository repository;
    @Mock private TtsVoiceRepository voiceRepository;
    @Mock private CryptoService cryptoService;
    @Mock private AiGatewayClient aiGatewayClient;
    @Mock private ProviderHealthService healthService;
    @Mock private ApplicationEventPublisher eventPublisher;

    private PlatformProviderServiceImpl service;
    private final UUID providerId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new PlatformProviderServiceImpl(repository, voiceRepository, cryptoService,
                aiGatewayClient, healthService, eventPublisher);
        lenient().when(cryptoService.encrypt(any())).thenReturn(new byte[]{1});
        lenient().when(repository.save(any(PlatformAiProvider.class))).thenAnswer(i -> {
            PlatformAiProvider p = i.getArgument(0);
            if (p.getId() == null) {
                p.setId(providerId);
            }
            return p;
        });
    }

    @Test
    void createTtsProviderRequestsVoiceSync() {
        service.create(new CreatePlatformAiProviderRequest("Azure TTS", "azure_speech", List.of("TTS"),
                "https://southeastasia.tts.speech.microsoft.com", "key", "azure-tts", null, null, null, null));

        verify(eventPublisher).publishEvent(TtsVoiceSyncRequested.platform(providerId));
    }

    @Test
    void createInactiveOrNonTtsProviderSkipsVoiceSync() {
        service.create(new CreatePlatformAiProviderRequest("LLM", "openai_compatible", List.of("TRANSLATE"),
                "https://api.example/v1", "key", "gpt", null, null, null, null));
        service.create(new CreatePlatformAiProviderRequest("Azure off", "azure_speech", List.of("TTS"),
                "https://southeastasia.tts.speech.microsoft.com", "key", "azure-tts", null, null, null, false));

        verifyNoInteractions(eventPublisher);
    }

    @Test
    void rotatingKeyRequestsVoiceSyncButRenameDoesNot() {
        PlatformAiProvider provider = ttsProvider();
        when(repository.findById(providerId)).thenReturn(Optional.of(provider));

        service.update(providerId, new UpdatePlatformAiProviderRequest("Renamed", null, null, null, null,
                null, null, null, null));
        verifyNoInteractions(eventPublisher);

        service.update(providerId, new UpdatePlatformAiProviderRequest(null, null, null, "new-key", null,
                null, null, null, null));
        verify(eventPublisher).publishEvent(TtsVoiceSyncRequested.platform(providerId));
    }

    private PlatformAiProvider ttsProvider() {
        PlatformAiProvider provider = new PlatformAiProvider();
        provider.setId(providerId);
        provider.setName("Azure TTS");
        provider.setProtocol("azure_speech");
        provider.setCapabilities(List.of("TTS"));
        provider.setBaseUrl("https://southeastasia.tts.speech.microsoft.com");
        provider.setDefaultModel("azure-tts");
        provider.setActive(true);
        return provider;
    }
}
