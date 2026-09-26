package com.app.modules.provider.dto;

import com.app.modules.provider.entity.TtsVoice;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record TtsVoiceResponse(
        UUID id,
        String providerSource,
        UUID userProviderId,
        UUID platformProviderId,
        String voiceId,
        String language,
        List<String> languages,
        String gender,
        String displayName,
        String status,
        boolean isActive,
        Instant cachedAt
) {
    public static TtsVoiceResponse from(TtsVoice entity) {
        return new TtsVoiceResponse(
                entity.getId(),
                entity.getProviderSource(),
                entity.getUserProviderId(),
                entity.getPlatformProviderId(),
                entity.getVoiceId(),
                entity.getLanguage(),
                entity.getLanguages(),
                entity.getGender(),
                entity.getDisplayName() != null && !entity.getDisplayName().isBlank()
                        ? entity.getDisplayName() : entity.getVoiceId(),
                entity.getStatus(),
                entity.isActive(),
                entity.getCachedAt()
        );
    }
}
