package com.app.modules.provider.service;

import com.app.modules.provider.dto.PreviewTtsVoiceRequest;
import com.app.modules.provider.dto.PreviewTtsVoiceResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;

import java.util.List;
import java.util.UUID;

public interface TtsVoiceService {

    List<TtsVoiceResponse> listUserVoices(UUID userId, UUID providerId, String language);

    List<TtsVoiceResponse> refreshUserVoices(UUID userId, UUID providerId);

    List<TtsVoiceResponse> listPlatformVoices(String language, String providerSource);

    /** Synthesizes a short preview clip for a cached TTS voice (API_Contract.md §11). Free; rate-limited per user. */
    PreviewTtsVoiceResponse previewVoice(UUID userId, PreviewTtsVoiceRequest request);
}
