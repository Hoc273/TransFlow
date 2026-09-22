package com.app.modules.provider.service.impl;

import com.app.modules.provider.service.TtsPreviewRateLimiter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.UUID;

/**
 * Redis fixed-window counter, same mechanism as {@code BatchCreateRateLimiterImpl}
 * (module boundary — the batch class is not referenced directly).
 * Defaults: 20 previews per user per 10-minute window, overridable via
 * {@code TTS_PREVIEW_RATE_LIMIT_MAX} / {@code TTS_PREVIEW_RATE_LIMIT_WINDOW_SECONDS}.
 */
@Service
public class TtsPreviewRateLimiterImpl implements TtsPreviewRateLimiter {

    private static final String KEY_PREFIX = "tts:preview:";

    private final StringRedisTemplate redis;
    private final long maxPerWindow;
    private final Duration window;

    public TtsPreviewRateLimiterImpl(
            StringRedisTemplate redis,
            @Value("${app.tts-preview.rate-limit-max:20}") long maxPerWindow,
            @Value("${app.tts-preview.rate-limit-window-seconds:600}") long windowSeconds) {
        this.redis = redis;
        this.maxPerWindow = maxPerWindow;
        this.window = Duration.ofSeconds(windowSeconds);
    }

    @Override
    public boolean isRateLimited(UUID userId) {
        String key = KEY_PREFIX + userId;
        Long count = redis.opsForValue().increment(key);
        if (count != null && count == 1L) {
            redis.expire(key, window);
        }
        return count != null && count > maxPerWindow;
    }
}
