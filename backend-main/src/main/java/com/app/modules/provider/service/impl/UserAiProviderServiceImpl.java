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
import com.app.modules.provider.entity.UserAiProviderDefault;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.repository.UserAiProviderDefaultRepository;
import com.app.modules.provider.repository.UserAiProviderRepository;
import com.app.modules.provider.service.UserAiProviderService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class UserAiProviderServiceImpl implements UserAiProviderService {

    static final Set<String> ALLOWED_PROTOCOLS = Set.of(
            "openai_compatible",
            "anthropic",
            "elevenlabs_native",
            "azure_speech",
            "google_speech",
            "dashscope_native"
    );

    static final Set<String> ALLOWED_CAPABILITIES = Set.of(
            "STT",
            "TRANSLATE",
            "TTS",
            "VISION"
    );

    private final UserAiProviderRepository providerRepository;
    private final TtsVoiceRepository ttsVoiceRepository;
    private final UserAiProviderDefaultRepository providerDefaultRepository;
    private final CryptoService cryptoService;
    private final AiGatewayClient aiGatewayClient;

    public UserAiProviderServiceImpl(UserAiProviderRepository providerRepository,
                                     TtsVoiceRepository ttsVoiceRepository,
                                     UserAiProviderDefaultRepository providerDefaultRepository,
                                     CryptoService cryptoService,
                                     AiGatewayClient aiGatewayClient) {
        this.providerRepository = providerRepository;
        this.ttsVoiceRepository = ttsVoiceRepository;
        this.providerDefaultRepository = providerDefaultRepository;
        this.cryptoService = cryptoService;
        this.aiGatewayClient = aiGatewayClient;
    }

    @Override
    @Transactional(readOnly = true)
    public List<UserAiProviderResponse> listProviders(UUID userId) {
        var defaults = providerDefaultRepository.findAllForUser(userId).stream()
                .collect(java.util.stream.Collectors.groupingBy(
                        d -> d.getProviderId(),
                        java.util.stream.Collectors.mapping(d -> d.getId().getCapability(),
                                java.util.stream.Collectors.toList())));
        return providerRepository.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(provider -> UserAiProviderResponse.from(provider,
                        defaults.getOrDefault(provider.getId(), List.of()).stream().sorted().toList()))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public UserAiProviderResponse getProvider(UUID userId, UUID id) {
        UserAiProvider provider = providerRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));
        return UserAiProviderResponse.from(provider, defaultsFor(provider.getId()));
    }

    @Override
    @Transactional
    public UserAiProviderResponse createProvider(UUID userId, CreateUserAiProviderRequest request) {
        validateProtocol(request.protocol());
        validateCapabilities(request.capabilities());
        List<String> capabilities = normalize(request.capabilities());
        List<String> defaults = validateDefaults(request.defaultForCapabilities(), capabilities, true,
                request.defaultModel());

        byte[] apiKeyEnc = cryptoService.encrypt(request.apiKey());
        String apiKeyHint = CryptoService.hint(request.apiKey());

        UserAiProvider provider = new UserAiProvider();
        provider.setUserId(userId);
        provider.setProtocol(request.protocol().toLowerCase());
        provider.setCapabilities(capabilities);
        provider.setBaseUrl(request.baseUrl().trim());
        provider.setApiKeyEnc(apiKeyEnc);
        provider.setApiKeyHint(apiKeyHint);
        provider.setDefaultModel(request.defaultModel() != null ? request.defaultModel().trim() : null);
        provider.setActive(true);

        provider = providerRepository.save(provider);
        replaceDefaults(userId, provider, defaults);
        return UserAiProviderResponse.from(provider, defaults);
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
            provider.setCapabilities(normalize(request.capabilities()));
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
        if (request.isActive() != null) provider.setActive(request.isActive());

        List<String> selectedDefaults = request.defaultForCapabilities() == null ? null
                : provider.isActive()
                ? validateDefaults(request.defaultForCapabilities(), provider.getCapabilities(), true,
                        provider.getDefaultModel())
                : List.of();

        provider = providerRepository.save(provider);
        if (selectedDefaults != null) {
            replaceDefaults(userId, provider, selectedDefaults);
        } else {
            removeInvalidDefaults(provider);
        }
        return UserAiProviderResponse.from(provider, defaultsFor(provider.getId()));
    }

    @Override
    @Transactional
    public void deleteProvider(UUID userId, UUID id) {
        UserAiProvider provider = providerRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));

        ttsVoiceRepository.deleteByUserProviderId(id);
        providerDefaultRepository.deleteForProvider(id);
        providerRepository.delete(provider);
    }

    @Override
    @Transactional(readOnly = true)
    public TestConnectionResponse testProvider(UUID userId, UUID id, String requestedCapability) {
        UserAiProvider provider = providerRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));

        List<String> capabilities = requestedCapability == null || requestedCapability.isBlank()
                ? defaultsFor(id).isEmpty() ? provider.getCapabilities() : defaultsFor(id)
                : List.of(normalizeCapability(requestedCapability));
        String rawApiKey = cryptoService.decrypt(provider.getApiKeyEnc());
        boolean authSuccess = aiGatewayClient.testConnection(provider.getProtocol(), provider.getBaseUrl(), rawApiKey);
        List<TestConnectionResponse.CapabilityTestResult> results = capabilities.stream()
                .map(capability -> {
                    if (!provider.isActive() || !provider.hasCapability(capability)) {
                        throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
                    }
                    String model = provider.getDefaultModel();
                    if (model == null || model.isBlank()) {
                        return new TestConnectionResponse.CapabilityTestResult(capability, false, model,
                                ErrorCode.PROVIDER_MODEL_NOT_CONFIGURED.name(), ErrorCode.PROVIDER_MODEL_NOT_CONFIGURED.getMessage());
                    }
                    var probe = aiGatewayClient.probeCapability(provider.getProtocol(), provider.getBaseUrl(),
                            rawApiKey, model.trim(), capability);
                    return new TestConnectionResponse.CapabilityTestResult(capability, probe.success() && authSuccess,
                            probe.model(), probe.errorCode() != null ? probe.errorCode()
                                    : authSuccess ? null : "PROVIDER_AUTH_FAILED",
                            probe.message() != null ? probe.message()
                                    : authSuccess ? null : "Provider authentication failed");
                }).toList();
        boolean success = authSuccess && results.stream().allMatch(TestConnectionResponse.CapabilityTestResult::success);
        return new TestConnectionResponse(success,
                success ? "Provider authentication and model probes passed"
                        : authSuccess ? "One or more capability probes failed" : "Provider authentication failed",
                authSuccess, results);
    }

    private List<String> defaultsFor(UUID providerId) {
        return providerDefaultRepository.findByProviderId(providerId).stream()
                .map(d -> d.getId().getCapability()).sorted().toList();
    }

    private List<String> normalize(List<String> values) {
        return values.stream().map(this::normalizeCapability).distinct().toList();
    }

    private String normalizeCapability(String value) {
        if (value == null) throw new AppException(ErrorCode.VALIDATION_ERROR);
        String normalized = value.trim().toUpperCase(Locale.ROOT);
        return "TEXT".equals(normalized) ? "TRANSLATE" : normalized;
    }

    private List<String> validateDefaults(List<String> requested, List<String> capabilities, boolean active,
                                          String defaultModel) {
        if (requested == null || requested.isEmpty()) return List.of();
        if (!active) throw new AppException(ErrorCode.PROVIDER_DEFAULT_NOT_CONFIGURED);
        if (defaultModel == null || defaultModel.isBlank()) {
            throw new AppException(ErrorCode.PROVIDER_MODEL_NOT_CONFIGURED);
        }
        List<String> defaults = normalize(requested);
        for (String capability : defaults) {
            if (!ALLOWED_CAPABILITIES.contains(capability) || !capabilities.contains(capability)) {
                throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
            }
        }
        return defaults.stream().sorted().toList();
    }

    private void replaceDefaults(UUID userId, UserAiProvider provider, List<String> capabilities) {
        for (UserAiProviderDefault existing : providerDefaultRepository.findByProviderId(provider.getId())) {
            if (!capabilities.contains(existing.getId().getCapability())) {
                providerDefaultRepository.deleteForCapability(userId, existing.getId().getCapability());
            }
        }
        for (String capability : capabilities) {
            UserAiProviderDefault mapping = providerDefaultRepository.findForCapability(userId, capability)
                    .orElseGet(() -> new UserAiProviderDefault(userId, capability, provider.getId()));
            mapping.setProviderId(provider.getId());
            providerDefaultRepository.save(mapping);
        }
    }

    private void removeInvalidDefaults(UserAiProvider provider) {
        for (UserAiProviderDefault mapping : providerDefaultRepository.findByProviderId(provider.getId())) {
            if (!provider.isActive() || !provider.hasCapability(mapping.getId().getCapability())) {
                providerDefaultRepository.deleteForCapability(provider.getUserId(), mapping.getId().getCapability());
            }
        }
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
