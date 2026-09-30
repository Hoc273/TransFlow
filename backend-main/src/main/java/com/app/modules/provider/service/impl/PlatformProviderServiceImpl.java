package com.app.modules.provider.service.impl;

import com.app.common.crypto.CryptoService;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.dto.CreatePlatformAiProviderRequest;
import com.app.modules.provider.dto.PlatformAiProviderResponse;
import com.app.modules.provider.dto.TestConnectionResponse;
import com.app.modules.provider.dto.UpdatePlatformAiProviderRequest;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.event.TtsVoiceSyncRequested;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.service.PlatformProviderService;
import com.app.modules.provider.service.ProviderHealthService;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.provider.util.ProviderProtocolCapabilities;
import com.app.modules.provider.util.TtsVoiceCatalog;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class PlatformProviderServiceImpl implements PlatformProviderService {

    /**
     * Probe failures that mean the key or its configuration is broken (not a transient
     * limit), so the health check takes the key out of the pool.
     */
    static final Set<String> BROKEN_KEY_ERRORS = Set.of(
            "PROVIDER_AUTH_FAILED", "PROVIDER_PERMISSION_DENIED", "PROVIDER_ACCOUNT_SUSPENDED",
            "PROVIDER_QUOTA_EXCEEDED", "PROVIDER_MODEL_NOT_FOUND", "PROVIDER_UNSUPPORTED_MODEL",
            "PROVIDER_ENDPOINT_NOT_FOUND", "PROVIDER_INVALID_BASE_URL", "PROVIDER_UNSUPPORTED_PROTOCOL",
            "PROVIDER_MODEL_NOT_CONFIGURED");

    private final PlatformAiProviderRepository repository;
    private final TtsVoiceRepository voiceRepository;
    private final CryptoService cryptoService;
    private final AiGatewayClient aiGatewayClient;
    private final ProviderHealthService healthService;
    private final ApplicationEventPublisher eventPublisher;

    public PlatformProviderServiceImpl(PlatformAiProviderRepository repository,
                                       TtsVoiceRepository voiceRepository,
                                       CryptoService cryptoService,
                                       AiGatewayClient aiGatewayClient,
                                       ProviderHealthService healthService,
                                       ApplicationEventPublisher eventPublisher) {
        this.repository = repository;
        this.voiceRepository = voiceRepository;
        this.cryptoService = cryptoService;
        this.aiGatewayClient = aiGatewayClient;
        this.healthService = healthService;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional(readOnly = true)
    public List<PlatformAiProviderResponse> list() {
        return repository.findAll().stream()
                .sorted(Comparator.comparing((PlatformAiProvider p) -> !p.isActive())
                        .thenComparingInt(PlatformAiProvider::getPriority)
                        .thenComparing(PlatformAiProvider::getName, String.CASE_INSENSITIVE_ORDER))
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional
    public PlatformAiProviderResponse create(CreatePlatformAiProviderRequest request) {
        PlatformAiProvider provider = new PlatformAiProvider();
        provider.setName(request.name().trim());
        provider.setProtocol(protocol(request.protocol()));
        provider.setCapabilities(capabilities(request.capabilities()));
        ProviderProtocolCapabilities.require(provider.getProtocol(), provider.getCapabilities());
        provider.setBaseUrl(request.baseUrl().trim());
        setKey(provider, request.apiKey());
        provider.setDefaultModel(request.defaultModel().trim());
        provider.setPriority((short) (request.priority() == null ? 100 : request.priority()));
        provider.setWeight((short) (request.weight() == null ? 1 : request.weight()));
        provider.setTier(tier(request.tier(), PlatformAiProvider.Tier.PAID));
        provider.setActive(request.isActive() == null || request.isActive());
        provider.setModelOverrides(modelOverrides(request.modelOverrides(), provider));
        PlatformAiProvider saved = repository.save(provider);
        requestVoiceSync(saved, true);
        return toResponse(saved);
    }

    @Override
    @Transactional
    public PlatformAiProviderResponse update(UUID id, UpdatePlatformAiProviderRequest request) {
        PlatformAiProvider provider = require(id);
        boolean credentialsChanged = false;
        boolean hadTts = provider.hasCapability("TTS");
        boolean wasActive = provider.isActive();
        if (request.name() != null && !request.name().isBlank()) {
            provider.setName(request.name().trim());
        }
        if (request.capabilities() != null) {
            provider.setCapabilities(capabilities(request.capabilities()));
            ProviderProtocolCapabilities.require(provider.getProtocol(), provider.getCapabilities());
        }
        if (request.baseUrl() != null && !request.baseUrl().isBlank()) {
            credentialsChanged |= !request.baseUrl().trim().equals(provider.getBaseUrl());
            provider.setBaseUrl(request.baseUrl().trim());
        }
        if (request.apiKey() != null && !request.apiKey().isBlank()) {
            setKey(provider, request.apiKey());
            credentialsChanged = true;
        }
        if (request.defaultModel() != null && !request.defaultModel().isBlank()) {
            credentialsChanged |= !request.defaultModel().trim().equals(provider.getDefaultModel());
            provider.setDefaultModel(request.defaultModel().trim());
        }
        if (request.priority() != null) {
            provider.setPriority(request.priority().shortValue());
        }
        if (request.weight() != null) {
            provider.setWeight(request.weight().shortValue());
        }
        if (request.tier() != null) {
            provider.setTier(tier(request.tier(), provider.getTier()));
        }
        if (request.isActive() != null) {
            provider.setActive(request.isActive());
        }
        if (request.modelOverrides() != null) {
            Map<String, String> overrides = modelOverrides(request.modelOverrides(), provider);
            credentialsChanged |= !overrides.equals(provider.getModelOverrides());
            provider.setModelOverrides(overrides);
        } else {
            // Drop overrides the key can no longer use after a capability change.
            provider.setModelOverrides(applicableOverrides(provider));
        }
        if (credentialsChanged) {
            // A rotated key or new model must earn its health again.
            provider.setHealthStatus(PlatformAiProvider.HealthStatus.UNKNOWN);
            provider.setLastErrorCode(null);
        }
        PlatformAiProvider saved = repository.save(provider);
        requestVoiceSync(saved, credentialsChanged || !hadTts || !wasActive);
        return toResponse(saved);
    }

    /** New key, endpoint or TTS capability: reload the voice catalog after commit (job picker reads it). */
    private void requestVoiceSync(PlatformAiProvider provider, boolean catalogMayBeStale) {
        if (catalogMayBeStale && provider.isActive() && provider.hasCapability("TTS")) {
            eventPublisher.publishEvent(TtsVoiceSyncRequested.platform(provider.getId()));
        }
    }

    @Override
    @Transactional
    public void delete(UUID id) {
        PlatformAiProvider provider = require(id);
        try {
            // Voices cascade; a job still bound to one of them rejects the delete.
            repository.delete(provider);
            repository.flush();
        } catch (DataIntegrityViolationException ex) {
            throw new AppException(ErrorCode.PROVIDER_IN_USE);
        }
    }

    @Override
    @Transactional
    public TestConnectionResponse test(UUID id) {
        PlatformAiProvider provider = require(id);
        String apiKey = cryptoService.decrypt(provider.getApiKeyEnc());
        boolean authOk = aiGatewayClient.testConnection(provider.getProtocol(), provider.getBaseUrl(), apiKey);
        List<TestConnectionResponse.CapabilityTestResult> results = new ArrayList<>();
        for (String capability : provider.getCapabilities()) {
            String model = provider.modelFor(capability);
            if (model == null || model.isBlank()) {
                results.add(new TestConnectionResponse.CapabilityTestResult(capability, false, null,
                        ErrorCode.PROVIDER_MODEL_NOT_CONFIGURED.name(), ErrorCode.PROVIDER_MODEL_NOT_CONFIGURED.getMessage()));
                continue;
            }
            var probe = aiGatewayClient.probeCapability(provider.getProtocol(), provider.getBaseUrl(), apiKey,
                    model.trim(), capability);
            results.add(new TestConnectionResponse.CapabilityTestResult(capability, probe.success(),
                    probe.model(), probe.errorCode(), probe.message()));
        }
        boolean success = authOk && results.stream().allMatch(TestConnectionResponse.CapabilityTestResult::success);
        applyHealth(provider, authOk, results);
        return new TestConnectionResponse(success,
                success ? "Provider authentication and model probes passed"
                        : authOk ? "One or more capability probes failed" : "Provider authentication failed",
                authOk, results);
    }

    @Override
    @Transactional
    public TestConnectionResponse healthCheck(UUID id) {
        PlatformAiProvider provider = require(id);
        if (provider.getTier() != PlatformAiProvider.Tier.FREE) {
            return test(id);
        }
        boolean authOk = aiGatewayClient.testConnection(provider.getProtocol(), provider.getBaseUrl(),
                cryptoService.decrypt(provider.getApiKeyEnc()));
        applyHealth(provider, authOk, List.of());
        return new TestConnectionResponse(authOk,
                authOk ? "Provider authentication passed (FREE key: capability probes skipped)"
                        : "Provider authentication failed",
                authOk, List.of());
    }

    @Override
    @Transactional
    public int syncVoices(UUID id) {
        PlatformAiProvider provider = require(id);
        if (!provider.hasCapability("TTS")) {
            throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
        }
        List<AiGatewayClient.DiscoveredVoice> discovered = aiGatewayClient.fetchTtsVoices(provider.getProtocol(),
                provider.getBaseUrl(), cryptoService.decrypt(provider.getApiKeyEnc()), provider.modelFor("TTS"));
        if (discovered == null || discovered.isEmpty()) {
            // An empty or failed discovery must never wipe a working voice catalog.
            throw new AppException(ErrorCode.PROVIDER_VOICES_FETCH_FAILED);
        }
        // Upsert; dropped or DEPRECATED voices are deactivated, never deleted: jobs may still reference them.
        return TtsVoiceCatalog.synchronize(voiceRepository, voiceRepository.findByPlatformProviderId(id), discovered,
                () -> {
                    TtsVoice voice = new TtsVoice();
                    voice.setProviderSource("PLATFORM");
                    voice.setPlatformProviderId(id);
                    return voice;
                }).size();
    }

    /**
     * Only a broken key (credentials, quota, model/endpoint configuration) is taken out of the
     * pool; transient probe failures such as a rate limit keep the previous status.
     */
    private void applyHealth(PlatformAiProvider provider, boolean authOk,
                             List<TestConnectionResponse.CapabilityTestResult> results) {
        provider.setLastCheckedAt(Instant.now());
        String failure = !authOk ? "PROVIDER_AUTH_FAILED" : results.stream()
                .filter(r -> !r.success())
                .map(r -> r.errorCode() == null ? "PROVIDER_UNKNOWN" : r.errorCode())
                .findFirst().orElse(null);
        provider.setLastErrorCode(failure);
        if (failure == null) {
            provider.setHealthStatus(PlatformAiProvider.HealthStatus.HEALTHY);
        } else if (BROKEN_KEY_ERRORS.contains(failure)) {
            provider.setHealthStatus(PlatformAiProvider.HealthStatus.DOWN);
        }
        repository.save(provider);
    }

    private PlatformAiProviderResponse toResponse(PlatformAiProvider provider) {
        return PlatformAiProviderResponse.from(provider, healthService.isCoolingDown(provider.getId()));
    }

    private PlatformAiProvider require(UUID id) {
        return repository.findById(id).orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));
    }

    private void setKey(PlatformAiProvider provider, String apiKey) {
        provider.setApiKeyEnc(cryptoService.encrypt(apiKey.trim()));
        provider.setApiKeyHint(CryptoService.hint(apiKey.trim()));
    }

    private static String protocol(String raw) {
        String protocol = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        if (!UserAiProviderServiceImpl.ALLOWED_PROTOCOLS.contains(protocol)) {
            throw new AppException(ErrorCode.INVALID_PROVIDER_PROTOCOL);
        }
        return protocol;
    }

    private static List<String> capabilities(List<String> raw) {
        List<String> normalized = raw == null ? List.of() : raw.stream()
                .filter(c -> c != null && !c.isBlank())
                .map(c -> c.trim().toUpperCase(Locale.ROOT))
                .distinct()
                .toList();
        if (normalized.isEmpty() || !UserAiProviderServiceImpl.ALLOWED_CAPABILITIES.containsAll(normalized)) {
            throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
        }
        return new ArrayList<>(normalized);
    }

    /**
     * Normalizes model overrides: upper-case keys, blank models dropped. A key is either an operation
     * from {@link ProviderResolverService#MODEL_OVERRIDE_OPERATIONS} (only a TRANSLATE key runs those)
     * or a capability from {@link ProviderResolverService#MODEL_OVERRIDE_CAPABILITIES} the key has.
     */
    static Map<String, String> modelOverrides(Map<String, String> raw, PlatformAiProvider provider) {
        Map<String, String> normalized = new LinkedHashMap<>();
        if (raw == null) {
            return normalized;
        }
        raw.forEach((rawKey, model) -> {
            String key = rawKey == null ? "" : rawKey.trim().toUpperCase(Locale.ROOT);
            if (model == null || model.isBlank()) {
                return; // a cleared field removes the override
            }
            boolean operation = ProviderResolverService.MODEL_OVERRIDE_OPERATIONS.contains(key);
            boolean capability = ProviderResolverService.MODEL_OVERRIDE_CAPABILITIES.contains(key);
            if (!operation && !capability) {
                throw new AppException(ErrorCode.VALIDATION_ERROR);
            }
            if ((operation && !provider.hasCapability("TRANSLATE")) || (capability && !provider.hasCapability(key))) {
                throw new AppException(ErrorCode.VALIDATION_ERROR);
            }
            if (model.trim().length() > 200) {
                throw new AppException(ErrorCode.VALIDATION_ERROR);
            }
            normalized.put(key, model.trim());
        });
        return normalized;
    }

    /** The stored overrides the key's current capabilities can still use. */
    static Map<String, String> applicableOverrides(PlatformAiProvider provider) {
        Map<String, String> kept = new LinkedHashMap<>();
        if (provider.getModelOverrides() == null) {
            return kept;
        }
        provider.getModelOverrides().forEach((key, model) -> {
            boolean operation = ProviderResolverService.MODEL_OVERRIDE_OPERATIONS.contains(key);
            if (operation ? provider.hasCapability("TRANSLATE") : provider.hasCapability(key)) {
                kept.put(key, model);
            }
        });
        return kept;
    }

    private static PlatformAiProvider.Tier tier(String raw, PlatformAiProvider.Tier fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        try {
            return PlatformAiProvider.Tier.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
    }
}
