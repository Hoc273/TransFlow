package com.app.modules.provider.service.impl;

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
import com.app.modules.provider.service.ProviderHealthService;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.provider.service.ProviderUsageScope;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.IntUnaryOperator;
import java.util.function.Predicate;

/**
 * Resolves AI provider credentials for a given capability before Spring calls FastAPI (backend-ai).
 * Priority order:
 * 1. User's personal BYOK provider (if configured and active) -> isPersonalApiKey = true
 * 2. Shared platform pool -> isPersonalApiKey = false. Among active keys for the capability the
 *    lowest {@code priority} group with an available key wins (not DOWN, not cooling down, not
 *    already failed in this stage attempt), weighted-random by {@code weight} inside the group.
 * See CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §2.4/§4.
 */
@Service
public class ProviderResolverServiceImpl implements ProviderResolverService {

    private final UserAiProviderRepository userAiProviderRepository;
    private final PlatformAiProviderRepository platformAiProviderRepository;
    private final TtsVoiceRepository ttsVoiceRepository;
    private final UserAiProviderDefaultRepository userAiProviderDefaultRepository;
    private final CryptoService cryptoService;
    private final ProviderHealthService healthService;

    @org.springframework.beans.factory.annotation.Autowired
    public ProviderResolverServiceImpl(UserAiProviderRepository userAiProviderRepository,
                                       PlatformAiProviderRepository platformAiProviderRepository,
                                       TtsVoiceRepository ttsVoiceRepository,
                                       UserAiProviderDefaultRepository userAiProviderDefaultRepository,
                                       CryptoService cryptoService,
                                       ProviderHealthService healthService) {
        this.userAiProviderRepository = userAiProviderRepository;
        this.platformAiProviderRepository = platformAiProviderRepository;
        this.ttsVoiceRepository = ttsVoiceRepository;
        this.userAiProviderDefaultRepository = userAiProviderDefaultRepository;
        this.cryptoService = cryptoService;
        this.healthService = healthService;
    }

    /** Test constructor without a health service: every active key is available. */
    public ProviderResolverServiceImpl(UserAiProviderRepository userAiProviderRepository,
                                       PlatformAiProviderRepository platformAiProviderRepository,
                                       TtsVoiceRepository ttsVoiceRepository,
                                       UserAiProviderDefaultRepository userAiProviderDefaultRepository,
                                       CryptoService cryptoService) {
        this(userAiProviderRepository, platformAiProviderRepository, ttsVoiceRepository,
                userAiProviderDefaultRepository, cryptoService, null);
    }

    @Override
    @Transactional(readOnly = true)
    public ProviderResolution resolveForCapability(UUID userId, String capability) {
        if (capability == null || capability.isBlank()) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        String normCap = capability.trim().toUpperCase();

        // 1. Use the explicit capability default when configured.
        if (userId != null) {
            List<UserAiProvider> userProviders = userAiProviderRepository.findByUserIdAndIsActiveTrue(userId);
            Optional<com.app.modules.provider.entity.UserAiProviderDefault> configuredDefault =
                    userAiProviderDefaultRepository.findForCapability(userId, normCap);
            if (configuredDefault.isPresent()) {
                UserAiProvider p = userAiProviderRepository.findByIdAndUserId(
                                configuredDefault.get().getProviderId(), userId)
                        .filter(UserAiProvider::isActive)
                        .filter(provider -> provider.hasCapability(normCap))
                        .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_DEFAULT_NOT_CONFIGURED));
                String rawApiKey = cryptoService.decrypt(p.getApiKeyEnc());
                return record(normCap, userResolution(p.getId(), p.getProtocol(), p.getBaseUrl(), rawApiKey,
                        p.getDefaultModel(), true));
            }

            List<UserAiProvider> matchingUserProviders = userProviders.stream()
                    .filter(p -> p.hasCapability(normCap))
                    .toList();
            if (matchingUserProviders.size() > 1) {
                throw new AppException(ErrorCode.PROVIDER_DEFAULT_NOT_CONFIGURED);
            }
            if (matchingUserProviders.size() == 1) {
                UserAiProvider p = matchingUserProviders.get(0);
                String rawApiKey = cryptoService.decrypt(p.getApiKeyEnc());
                return record(normCap, userResolution(p.getId(), p.getProtocol(), p.getBaseUrl(), rawApiKey,
                        p.getDefaultModel(), true));
            }
        }

        // 2. Shared platform pool
        List<PlatformAiProvider> candidates = platformAiProviderRepository.findByIsActiveTrue().stream()
                .filter(p -> p.hasCapability(normCap))
                .toList();
        Optional<PlatformAiProvider> matchingPlatform = selectPlatform(candidates, this::isAvailable,
                bound -> ThreadLocalRandom.current().nextInt(bound));

        if (matchingPlatform.isPresent()) {
            PlatformAiProvider p = matchingPlatform.get();
            String rawApiKey = cryptoService.decrypt(p.getApiKeyEnc());
            return record(normCap, userResolution(p.getId(), p.getProtocol(), p.getBaseUrl(), rawApiKey,
                    p.getDefaultModel(), false));
        }

        // 3. No active provider configured for capability
        throw new AppException(ErrorCode.PLATFORM_PROVIDER_NOT_CONFIGURED);
    }

    @Override
    @Transactional(readOnly = true)
    public ProviderResolution resolveBoundProvider(UUID userId, UUID providerId, String capability) {
        if (providerId == null) {
            return resolveForCapability(userId, capability);
        }
        String normCap = capability == null ? "" : capability.trim().toUpperCase();
        if (userId != null) {
            Optional<UserAiProvider> own = userAiProviderRepository.findByIdAndUserId(providerId, userId)
                    .filter(UserAiProvider::isActive)
                    .filter(p -> p.hasCapability(normCap));
            if (own.isPresent()) {
                UserAiProvider p = own.get();
                return record(normCap, userResolution(p.getId(), p.getProtocol(), p.getBaseUrl(),
                        cryptoService.decrypt(p.getApiKeyEnc()), p.getDefaultModel(), true));
            }
        }
        PlatformAiProvider p = platformAiProviderRepository.findById(providerId)
                .filter(PlatformAiProvider::isActive)
                .filter(candidate -> candidate.hasCapability(normCap))
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));
        return record(normCap, userResolution(p.getId(), p.getProtocol(), p.getBaseUrl(),
                cryptoService.decrypt(p.getApiKeyEnc()), p.getDefaultModel(), false));
    }

    /**
     * Pool selection: the lowest-priority group that has an available key, weighted-random
     * inside it. When no key is available at all (every key DOWN or cooling down) the
     * best-ranked key is still returned: a stale health flag must never block every job.
     */
    static Optional<PlatformAiProvider> selectPlatform(List<PlatformAiProvider> candidates,
                                                        Predicate<PlatformAiProvider> available,
                                                        IntUnaryOperator random) {
        if (candidates.isEmpty()) {
            return Optional.empty();
        }
        Comparator<PlatformAiProvider> rank = Comparator
                .comparingInt((PlatformAiProvider p) -> p.getPriority())
                .thenComparing(p -> p.getCreatedAt() == null ? Instant.EPOCH : p.getCreatedAt());
        List<PlatformAiProvider> usable = candidates.stream().filter(available).sorted(rank).toList();
        if (usable.isEmpty()) {
            return candidates.stream().min(Comparator
                    .comparing((PlatformAiProvider p) -> p.getHealthStatus() == PlatformAiProvider.HealthStatus.DOWN)
                    .thenComparing(rank));
        }
        short top = usable.get(0).getPriority();
        List<PlatformAiProvider> group = usable.stream().filter(p -> p.getPriority() == top).toList();
        int total = group.stream().mapToInt(p -> Math.max(1, (int) p.getWeight())).sum();
        int pick = random.applyAsInt(total);
        for (PlatformAiProvider p : group) {
            pick -= Math.max(1, (int) p.getWeight());
            if (pick < 0) {
                return Optional.of(p);
            }
        }
        return Optional.of(group.get(group.size() - 1));
    }

    private boolean isAvailable(PlatformAiProvider provider) {
        if (provider.getHealthStatus() == PlatformAiProvider.HealthStatus.DOWN) {
            return false;
        }
        if (healthService == null) {
            return true;
        }
        String scopeKey = ProviderUsageScope.current().map(ProviderUsageScope::key).orElse(null);
        return !healthService.isCoolingDown(provider.getId())
                && !healthService.isExcludedForScope(scopeKey, provider.getId());
    }

    private ProviderResolution record(String capability, ProviderResolution resolution) {
        ProviderUsageScope.recordResolution(capability, resolution.providerId(), !resolution.isPersonalApiKey());
        return resolution;
    }

    private ProviderResolution userResolution(UUID providerId, String protocol, String baseUrl,
                                              String apiKey, String model, boolean personal) {
        if (model == null || model.isBlank()) {
            throw new AppException(ErrorCode.PROVIDER_MODEL_NOT_CONFIGURED);
        }
        return new ProviderResolution(providerId, protocol, baseUrl, apiKey, model.trim(), personal);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> resolveVoiceLanguage(UUID userId, UUID ttsProviderId, UUID ttsVoiceId) {
        if (ttsProviderId == null || ttsVoiceId == null) {
            return Optional.empty();
        }
        return ttsVoiceRepository.findById(ttsVoiceId)
                .filter(TtsVoice::isActive)
                .filter(voice -> providerOwnsVoiceAndIsAvailable(userId, ttsProviderId, voice))
                .map(TtsVoice::getLanguage);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean isVoiceLanguageCompatible(UUID userId, UUID ttsProviderId, UUID ttsVoiceId, String targetLang) {
        if (ttsProviderId == null || ttsVoiceId == null) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        TtsVoice voice = ttsVoiceRepository.findById(ttsVoiceId)
                .filter(TtsVoice::isActive)
                .filter(candidate -> providerOwnsVoiceAndIsAvailable(userId, ttsProviderId, candidate))
                .orElseThrow(() -> new AppException(ErrorCode.VALIDATION_ERROR));
        return voice.isLanguageCompatible(targetLang);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> resolveVoiceIdentifier(UUID userId, UUID ttsProviderId, UUID ttsVoiceId) {
        if (ttsProviderId == null || ttsVoiceId == null) {
            return Optional.empty();
        }
        return ttsVoiceRepository.findById(ttsVoiceId)
                .filter(TtsVoice::isActive)
                .filter(voice -> providerOwnsVoiceAndIsAvailable(userId, ttsProviderId, voice))
                .map(TtsVoice::getVoiceId);
    }

    @Override
    @Transactional(readOnly = true)
    public ResolvedVoice resolveLegacyVoice(UUID userId, String voiceId, String targetLang) {
        if (voiceId == null || voiceId.isBlank()) {
            throw new AppException(ErrorCode.VOICE_LANGUAGE_MISMATCH);
        }
        String trimmed = voiceId.trim();
        List<TtsVoice> candidates = ttsVoiceRepository.findByVoiceIdAndIsActiveTrue(trimmed);

        List<TtsVoice> langMatches = candidates.stream()
                .filter(v -> v.isLanguageCompatible(targetLang))
                .toList();

        if (langMatches.isEmpty()) {
            throw new AppException(ErrorCode.VOICE_LANGUAGE_MISMATCH);
        }

        List<ResolvedVoice> available = new ArrayList<>();
        for (TtsVoice voice : langMatches) {
            UUID providerId = "USER".equalsIgnoreCase(voice.getProviderSource())
                    ? voice.getUserProviderId()
                    : voice.getPlatformProviderId();
            if (providerId != null && providerOwnsVoiceAndIsAvailable(userId, providerId, voice)) {
                available.add(new ResolvedVoice(providerId, voice.getId(), voice.getLanguage()));
            }
        }

        if (available.isEmpty()) {
            throw new AppException(ErrorCode.VOICE_LANGUAGE_MISMATCH);
        }

        if (available.size() == 1) {
            return available.get(0);
        }

        // Prefer user BYOK match if exists
        for (ResolvedVoice r : available) {
            for (TtsVoice v : langMatches) {
                if (v.getId().equals(r.voiceId()) && "USER".equalsIgnoreCase(v.getProviderSource())) {
                    return r;
                }
            }
        }

        return available.get(0);
    }

    private boolean providerOwnsVoiceAndIsAvailable(UUID userId, UUID providerId, TtsVoice voice) {
        if ("USER".equalsIgnoreCase(voice.getProviderSource())) {
            return providerId.equals(voice.getUserProviderId())
                    && userId != null
                    && userAiProviderRepository.findByIdAndUserId(providerId, userId)
                    .filter(UserAiProvider::isActive)
                    .filter(provider -> provider.hasCapability("TTS"))
                    .isPresent();
        }
        if ("PLATFORM".equalsIgnoreCase(voice.getProviderSource())) {
            return providerId.equals(voice.getPlatformProviderId())
                    && platformAiProviderRepository.findById(providerId)
                    .filter(PlatformAiProvider::isActive)
                    .filter(provider -> provider.hasCapability("TTS"))
                    .isPresent();
        }
        return false;
    }
}
