package com.app.modules.provider.service;

import com.app.modules.provider.dto.PlatformTtsProviderResponse;
import com.app.modules.provider.dto.PreviewTtsVoiceRequest;
import com.app.modules.provider.dto.PreviewTtsVoiceResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;

import java.util.List;
import java.util.UUID;

public interface TtsVoiceService {

    List<TtsVoiceResponse> listUserVoices(UUID userId, UUID providerId, String language);

    List<TtsVoiceResponse> refreshUserVoices(UUID userId, UUID providerId);

    /** Active platform voices, optionally narrowed to one platform key. Never returns BYOK voices. */
    List<TtsVoiceResponse> listPlatformVoices(String language, UUID platformProviderId);

    /** Active platform keys with the TTS capability, for the user voice picker (no secrets). */
    List<PlatformTtsProviderResponse> listPlatformTtsProviders();

    /** Synthesizes a short preview clip for a cached TTS voice (API_Contract.md §11). Free; rate-limited per user. */
    PreviewTtsVoiceResponse previewVoice(UUID userId, PreviewTtsVoiceRequest request);
}
