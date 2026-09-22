package com.app.modules.provider.service;

import com.app.modules.provider.dto.TtsVoicePreviewRequest;
import com.app.modules.provider.dto.TtsVoicePreviewResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;

import java.util.List;
import java.util.UUID;

public interface TtsVoiceService {

    List<TtsVoiceResponse> listUserVoices(UUID userId, UUID providerId, String language);

    List<TtsVoiceResponse> refreshUserVoices(UUID userId, UUID providerId);

    List<TtsVoiceResponse> listPlatformVoices(String language, String providerSource);

    /**
     * Synthesizes a short preview for a catalog voice and returns a presigned mp3 URL.
     * Free (no credit charge); per-user rate limit via {@link TtsPreviewRateLimiter}.
     */
    TtsVoicePreviewResponse previewVoice(UUID userId, TtsVoicePreviewRequest request);
}
