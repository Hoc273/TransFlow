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
    public Optional<String> resolveVoiceLanguage(UUID ttsVoiceId) {
        return ttsVoiceRepository.findById(ttsVoiceId).map(TtsVoice::getLanguage);
    }

    @Override
    @Transactional(readOnly = true)
    public TtsVoiceResolution resolveForTtsVoice(UUID userId, UUID ttsVoiceId) {
        TtsVoice voice = ttsVoiceRepository.findById(ttsVoiceId)
                .filter(TtsVoice::isActive)
                .orElseThrow(() -> new AppException(ErrorCode.TTS_VOICE_NOT_FOUND));

        if ("USER".equals(voice.getProviderSource())) {
            if (voice.getUserProviderId() == null) {
                throw new AppException(ErrorCode.PROVIDER_NOT_FOUND);
            }
            UserAiProvider p = userAiProviderRepository.findByIdAndUserId(voice.getUserProviderId(), userId)
                    .filter(UserAiProvider::isActive)
                    .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));
            if (!p.hasCapability("TTS")) {
                throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
            }
            return new TtsVoiceResolution(
                    voice.getVoiceId(),
                    p.getProtocol(),
                    p.getBaseUrl(),
                    cryptoService.decrypt(p.getApiKeyEnc()),
                    p.getDefaultModel(),
                    true
            );
        }

        if ("PLATFORM".equals(voice.getProviderSource())) {
            if (voice.getPlatformProviderId() == null) {
                throw new AppException(ErrorCode.PLATFORM_PROVIDER_NOT_CONFIGURED);
            }
            PlatformAiProvider p = platformAiProviderRepository.findById(voice.getPlatformProviderId())
                    .filter(PlatformAiProvider::isActive)
                    .orElseThrow(() -> new AppException(ErrorCode.PLATFORM_PROVIDER_NOT_CONFIGURED));
            if (!p.hasCapability("TTS")) {
                throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
            }
            return new TtsVoiceResolution(
                    voice.getVoiceId(),
                    p.getProtocol(),
                    p.getBaseUrl(),
                    cryptoService.decrypt(p.getApiKeyEnc()),
                    p.getDefaultModel(),
                    false
            );
        }

        throw new AppException(ErrorCode.TTS_VOICE_NOT_FOUND);
    }
}
