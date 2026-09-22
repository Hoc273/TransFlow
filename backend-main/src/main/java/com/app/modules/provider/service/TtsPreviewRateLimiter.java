package com.app.modules.provider.service;

import java.util.UUID;

/**
 * Per-user rate limit for the free TTS voice preview endpoint
 * ({@code POST /api/tts-voices/preview}). Limits are configurable via
 * {@code app.tts-preview.rate-limit-max} / {@code rate-limit-window-seconds}.
 */
public interface TtsPreviewRateLimiter {

    /**
     * Records one preview attempt for {@code userId} and returns {@code true} when the user
     * has exceeded the configured maximum within the current window.
     */
    boolean isRateLimited(UUID userId);
}
