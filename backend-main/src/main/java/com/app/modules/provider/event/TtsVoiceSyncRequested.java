package com.app.modules.provider.event;

import java.util.UUID;

/**
 * A TTS provider was created or its credentials changed: its voice catalog must be (re)loaded,
 * otherwise the job voice picker has nothing to offer until someone syncs it by hand.
 *
 * @param userId owner of a BYOK provider; {@code null} for a platform provider
 */
public record TtsVoiceSyncRequested(UUID providerId, UUID userId) {

    public static TtsVoiceSyncRequested platform(UUID providerId) {
        return new TtsVoiceSyncRequested(providerId, null);
    }

    public static TtsVoiceSyncRequested user(UUID userId, UUID providerId) {
        return new TtsVoiceSyncRequested(providerId, userId);
    }

    public boolean isPlatform() {
        return userId == null;
    }
}
