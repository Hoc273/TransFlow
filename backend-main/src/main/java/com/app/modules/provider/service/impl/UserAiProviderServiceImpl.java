package com.app.modules.provider.service.impl;

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
import com.app.modules.provider.service.UserAiProviderService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class UserAiProviderServiceImpl implements UserAiProviderService {

    private static final Set<String> ALLOWED_PROTOCOLS = Set.of(
            "openai_compatible",
            "anthropic",
            "elevenlabs_native",
            "azure_speech",
            "google_speech",
            "dashscope_native"
    );

    private static final Set<String> ALLOWED_CAPABILITIES = Set.of(
            "STT",
            "TRANSLATE",
            "TTS",
            "VISION"
    );

    private final UserAiProviderRepository providerRepository;
    private final TtsVoiceRepository ttsVoiceRepository;
    private final CryptoService cryptoService;
    private final AiGatewayClient aiGatewayClient;

    public UserAiProviderServiceImpl(UserAiProviderRepository providerRepository,
                                     TtsVoiceRepository ttsVoiceRepository,
                                     CryptoService cryptoService,
                                     AiGatewayClient aiGatewayClient) {
        this.providerRepository = providerRepository;
        this.ttsVoiceRepository = ttsVoiceRepository;
        this.cryptoService = cryptoService;
        this.aiGatewayClient = aiGatewayClient;
    }

    @Override
    @Transactional(readOnly = true)
    public List<UserAiProviderResponse> listProviders(UUID userId) {
        return providerRepository.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(UserAiProviderResponse::from)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public UserAiProviderResponse getProvider(UUID userId, UUID id) {
        UserAiProvider provider = providerRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));
        return UserAiProviderResponse.from(provider);
    }

    @Override
    @Transactional
    public UserAiProviderResponse createProvider(UUID userId, CreateUserAiProviderRequest request) {
        validateProtocol(request.protocol());
        validateCapabilities(request.capabilities());

        byte[] apiKeyEnc = cryptoService.encrypt(request.apiKey());
        String apiKeyHint = CryptoService.hint(request.apiKey());

        UserAiProvider provider = new UserAiProvider();
        provider.setUserId(userId);
        provider.setProtocol(request.protocol().toLowerCase());
        provider.setCapabilities(request.capabilities().stream().map(String::toUpperCase).toList());
        provider.setBaseUrl(request.baseUrl().trim());
        provider.setApiKeyEnc(apiKeyEnc);
        provider.setApiKeyHint(apiKeyHint);
        provider.setDefaultModel(request.defaultModel() != null ? request.defaultModel().trim() : null);
        provider.setActive(true);

        provider = providerRepository.save(provider);
        return UserAiProviderResponse.from(provider);
    }

    @Override
    @Transactional
    public UserAiProviderResponse updateProvider(UUID userId, UUID id, UpdateUserAiProviderRequest request) {
        UserAiProvider provider = providerRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));

        if (request.protocol() != null && !request.protocol().isBlank()) {
            validateProtocol(request.protocol());
            provider.setProtocol(request.protocol().toLowerCase());
        }
        if (request.capabilities() != null && !request.capabilities().isEmpty()) {
            validateCapabilities(request.capabilities());
            provider.setCapabilities(request.capabilities().stream().map(String::toUpperCase).toList());
        }
        if (request.baseUrl() != null && !request.baseUrl().isBlank()) {
            provider.setBaseUrl(request.baseUrl().trim());
        }
        if (request.defaultModel() != null) {
            provider.setDefaultModel(request.defaultModel().trim());
        }
        if (request.apiKey() != null && !request.apiKey().isBlank()) {
            provider.setApiKeyEnc(cryptoService.encrypt(request.apiKey()));
            provider.setApiKeyHint(CryptoService.hint(request.apiKey()));
        }
        if (request.isActive() != null) {
            provider.setActive(request.isActive());
        }

        provider = providerRepository.save(provider);
        return UserAiProviderResponse.from(provider);
    }

    @Override
    @Transactional
    public void deleteProvider(UUID userId, UUID id) {
        UserAiProvider provider = providerRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));

        ttsVoiceRepository.deleteByUserProviderId(id);
        providerRepository.delete(provider);
    }

    @Override
    @Transactional(readOnly = true)
    public TestConnectionResponse testProvider(UUID userId, UUID id) {
        UserAiProvider provider = providerRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));

        String rawApiKey = cryptoService.decrypt(provider.getApiKeyEnc());
        boolean success = aiGatewayClient.testConnection(provider.getProtocol(), provider.getBaseUrl(), rawApiKey);

        return new TestConnectionResponse(
                success,
                success ? "Connection test passed successfully" : "Connection test failed"
        );
    }

    private void validateProtocol(String protocol) {
        if (protocol == null || !ALLOWED_PROTOCOLS.contains(protocol.toLowerCase())) {
            throw new AppException(ErrorCode.INVALID_PROVIDER_PROTOCOL);
        }
    }

    private void validateCapabilities(List<String> capabilities) {
        if (capabilities == null || capabilities.isEmpty()) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        for (String cap : capabilities) {
            if (cap == null || !ALLOWED_CAPABILITIES.contains(cap.toUpperCase())) {
                throw new AppException(ErrorCode.VALIDATION_ERROR);
            }
        }
    }
}
