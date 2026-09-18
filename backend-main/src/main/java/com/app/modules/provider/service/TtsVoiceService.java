package com.app.modules.provider.service;

import com.app.modules.provider.dto.TtsVoiceResponse;

import java.util.List;
import java.util.UUID;

public interface TtsVoiceService {

    List<TtsVoiceResponse> listUserVoices(UUID userId, UUID providerId, String language);

    List<TtsVoiceResponse> refreshUserVoices(UUID userId, UUID providerId);

    List<TtsVoiceResponse> listPlatformVoices(String language, String providerSource);
}
