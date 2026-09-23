package com.app.modules.provider.service.impl;

import com.app.common.crypto.CryptoService;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.entity.UserAiProvider;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.repository.UserAiProviderRepository;
import com.app.modules.provider.service.ProviderResolverService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Resolves AI provider credentials for a given capability before Spring calls FastAPI (backend-ai).
 * Priority order:
 * 1. User's personal BYOK provider (if configured and active) -> isPersonalApiKey = true
 * 2. System platform provider fallback -> isPersonalApiKey = false
 * See CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §2.4/§4.
 */
@Service
public class ProviderResolverServiceImpl implements ProviderResolverService {

    private final UserAiProviderRepository userAiProviderRepository;
    private final PlatformAiProviderRepository platformAiProviderRepository;
    private final TtsVoiceRepository ttsVoiceRepository;
    private final CryptoService cryptoService;

    public ProviderResolverServiceImpl(UserAiProviderRepository userAiProviderRepository,
                                       PlatformAiProviderRepository platformAiProviderRepository,
                                       TtsVoiceRepository ttsVoiceRepository,
                                       CryptoService cryptoService) {
        this.userAiProviderRepository = userAiProviderRepository;
        this.platformAiProviderRepository = platformAiProviderRepository;
        this.ttsVoiceRepository = ttsVoiceRepository;
        this.cryptoService = cryptoService;
    }

    @Override
    @Transactional(readOnly = true)
    public ProviderResolution resolveForCapability(UUID userId, String capability) {
        if (capability == null || capability.isBlank()) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        String normCap = capability.trim().toUpperCase();

        // 1. Check user personal BYOK provider first
        if (userId != null) {
            List<UserAiProvider> userProviders = userAiProviderRepository.findByUserIdAndIsActiveTrue(userId);
            Optional<UserAiProvider> matchingUserProvider = userProviders.stream()
                    .filter(p -> p.hasCapability(normCap))
                    .findFirst();

            if (matchingUserProvider.isPresent()) {
                UserAiProvider p = matchingUserProvider.get();
                String rawApiKey = cryptoService.decrypt(p.getApiKeyEnc());
                return new ProviderResolution(
                        p.getProtocol(),
                        rawApiKey,
                        p.getBaseUrl(),
                        true // isPersonalApiKey
                );
            }
        }

        // 2. Fallback to platform AI provider
        List<PlatformAiProvider> platformProviders = platformAiProviderRepository.findByIsActiveTrue();
        Optional<PlatformAiProvider> matchingPlatform = platformProviders.stream()
                .filter(p -> p.hasCapability(normCap))
                .findFirst();

        if (matchingPlatform.isPresent()) {
            PlatformAiProvider p = matchingPlatform.get();
            String rawApiKey = cryptoService.decrypt(p.getApiKeyEnc());
            return new ProviderResolution(
                    p.getProtocol(),
                    rawApiKey,
                    p.getBaseUrl(),
                    false // isPersonalApiKey
            );
        }

        // 3. No active provider configured for capability
        throw new AppException(ErrorCode.PLATFORM_PROVIDER_NOT_CONFIGURED);
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
