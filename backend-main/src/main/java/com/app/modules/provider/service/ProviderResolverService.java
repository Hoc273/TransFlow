package com.app.modules.provider.service;

import java.util.Map;
import java.util.Optional;
import java.util.Set;
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
     * Like {@link #resolveBoundProvider(UUID, UUID, String)}, but when the bound provider is a
     * platform key that is unavailable (DOWN, cooling down or already failed in this stage), another
     * platform key of the same protocol that serves the exact same {@code voiceIdentifier} is used,
     * so the voice stays identical. Personal providers are never swapped.
     */
    ProviderResolution resolveBoundProvider(UUID userId, UUID providerId, String capability, String voiceIdentifier);

    /** True when another available platform key of the same protocol serves {@code voiceIdentifier}. */
    boolean hasVoiceSibling(UUID providerId, String voiceIdentifier);

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

    /**
     * Text operations that run on the TRANSLATE key but may use another model of the same
     * platform key (e.g. a FreeLLMAPI chain {@code auto:script}). Personal keys never override.
     */
    Set<String> MODEL_OVERRIDE_OPERATIONS = Set.of("SUMMARIZE_SCRIPT", "REFINE", "QA");

    /** {@code modelOverrides}: operation → model, from the platform key; empty for personal keys. */
    record ProviderResolution(
            UUID providerId,
            String providerType,
            String baseUrl,
            String apiKey,
            String model,
            boolean isPersonalApiKey,
            Map<String, String> modelOverrides
    ) {
        public ProviderResolution {
            modelOverrides = modelOverrides == null ? Map.of() : Map.copyOf(modelOverrides);
        }

        public ProviderResolution(UUID providerId, String providerType, String baseUrl, String apiKey,
                                  String model, boolean isPersonalApiKey) {
            this(providerId, providerType, baseUrl, apiKey, model, isPersonalApiKey, Map.of());
        }

        /** Model to send for {@code operation}: its override when the key has one, else {@link #model()}. */
        public String modelFor(String operation) {
            String override = operation == null ? null : modelOverrides.get(operation);
            return override == null || override.isBlank() ? model : override;
        }
    }
}
