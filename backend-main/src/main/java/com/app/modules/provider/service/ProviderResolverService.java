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

    /** Language of a tts_voices row, used to validate targetLang match (API_Contract.md §5). */
    Optional<String> resolveVoiceLanguage(UUID ttsVoiceId);

    /**
     * Resolves the provider that owns a catalog TTS voice, honoring {@code tts_voices.provider_source}:
     * {@code USER} -> BYOK provider referenced by {@code user_provider_id} (must belong to
     * {@code userId} and be active, otherwise {@code PROVIDER_NOT_FOUND});
     * {@code PLATFORM} -> platform provider referenced by {@code platform_provider_id}
     * (must be active, otherwise {@code PLATFORM_PROVIDER_NOT_CONFIGURED}).
     * Unknown or inactive voice -> {@code TTS_VOICE_NOT_FOUND}; provider lacking the {@code TTS}
     * capability -> {@code PROVIDER_CAPABILITY_NOT_SUPPORTED}.
     */
    TtsVoiceResolution resolveForTtsVoice(UUID userId, UUID ttsVoiceId);

    record ProviderResolution(
            String providerType,
            String apiKey,
            String endpointUrl,
            boolean isPersonalApiKey
    ) {}

    /**
     * A catalog voice plus the provider credentials needed to synthesize with it.
     * {@code voiceId} is the provider-side voice id ({@code tts_voices.voice_id}, e.g. "alloy");
     * {@code defaultModel} is forwarded to backend-ai as {@code provider.model}.
     */
    record TtsVoiceResolution(
            String voiceId,
            String protocol,
            String baseUrl,
            String apiKey,
            String defaultModel,
            boolean isPersonalApiKey
    ) {}
}
