package com.app.modules.provider.service.impl;

import com.app.common.crypto.CryptoService;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.entity.PlatformAiProvider;
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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** The scheduled check must not spend a FREE pool's quota on completion probes. */
@ExtendWith(MockitoExtension.class)
class PlatformProviderHealthCheckTest {

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
        when(cryptoService.decrypt(any())).thenReturn("key");
        when(aiGatewayClient.testConnection(anyString(), anyString(), anyString())).thenReturn(true);
    }

    @Test
    void freeKeyIsCheckedByAuthOnly() {
        PlatformAiProvider provider = provider(PlatformAiProvider.Tier.FREE);
        when(repository.findById(providerId)).thenReturn(Optional.of(provider));

        var result = service.healthCheck(providerId);

        assertTrue(result.success());
        assertEquals(PlatformAiProvider.HealthStatus.HEALTHY, provider.getHealthStatus());
        verify(aiGatewayClient, never()).probeCapability(any(), any(), any(), any(), any());
    }

    @Test
    void paidKeyStillRunsCapabilityProbes() {
        PlatformAiProvider provider = provider(PlatformAiProvider.Tier.PAID);
        when(repository.findById(providerId)).thenReturn(Optional.of(provider));
        when(aiGatewayClient.probeCapability(any(), any(), any(), any(), any()))
                .thenReturn(new AiGatewayClient.ProviderCapabilityProbe(true, "gpt", null, null));

        service.healthCheck(providerId);

        verify(aiGatewayClient, times(2)).probeCapability(any(), any(), any(), any(), any());
    }

    private PlatformAiProvider provider(PlatformAiProvider.Tier tier) {
        PlatformAiProvider provider = new PlatformAiProvider();
        provider.setId(providerId);
        provider.setProtocol("openai_compatible");
        provider.setBaseUrl("http://freellmapi:3001/v1");
        provider.setApiKeyEnc(new byte[]{1});
        provider.setDefaultModel("auto:translate");
        provider.setCapabilities(List.of("TRANSLATE", "VISION"));
        provider.setTier(tier);
        return provider;
    }
}
