package com.app.modules.provider.service;

import java.util.Optional;
import java.util.UUID;

/**
 * Interface provided by Member A for Member B to resolve AI provider credentials
 * (BYOK or platform) for a given capability before calling FastAPI (backend-ai).
 * See CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §4.
 */
public interface ProviderResolverService {

    ProviderResolution resolveForCapability(UUID userId, String capability);

    /**
     * Resolves one specific provider (the TTS provider a job's voice belongs to): the user's own
     * active provider or an active platform provider with {@code capability}. Voices are bound to
     * their provider, so TTS must not be load-balanced to another key of the pool.
     */
    ProviderResolution resolveBoundProvider(UUID userId, UUID providerId, String capability);

    /**
     * Resolves the language only when the requested active voice belongs to the requested active,
     * TTS-capable provider and that provider is available to the user. This is the public module
     * boundary used by media_job; callers must never validate provider repositories directly.
     */
    Optional<String> resolveVoiceLanguage(UUID userId, UUID ttsProviderId, UUID ttsVoiceId);

    /**
     * Checks compatibility only for an active voice owned by the requested active,
     * TTS-capable provider available to the user. Throws VALIDATION_ERROR when that
     * provider/voice binding cannot be resolved; false means the valid voice is incompatible.
     */
    boolean isVoiceLanguageCompatible(UUID userId, UUID ttsProviderId, UUID ttsVoiceId, String targetLang);

    Optional<String> resolveVoiceIdentifier(UUID userId, UUID ttsProviderId, UUID ttsVoiceId);

    /**
     * Legacy voiceId string resolution (ADR-CEP B7 parity).
     * Finds active voice by voice_id string matching targetLang and accessible to user.
     */
    ResolvedVoice resolveLegacyVoice(UUID userId, String voiceId, String targetLang);

    record ResolvedVoice(
            UUID providerId,
            UUID voiceId,
            String language
    ) {}

    record ProviderResolution(
            UUID providerId,
            String providerType,
            String baseUrl,
            String apiKey,
            String model,
            boolean isPersonalApiKey
    ) {}
}
