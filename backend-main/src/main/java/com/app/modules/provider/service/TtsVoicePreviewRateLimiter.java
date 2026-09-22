package com.app.modules.provider.service;

import java.util.UUID;

/** Per-user rate limit for POST /api/tts-voices/preview (API_Contract.md §11). */
public interface TtsVoicePreviewRateLimiter {

    /** Throws {@code AppException(TTS_PREVIEW_RATE_LIMIT_EXCEEDED)} when the user exceeds the window limit. */
    void check(UUID userId);
}
