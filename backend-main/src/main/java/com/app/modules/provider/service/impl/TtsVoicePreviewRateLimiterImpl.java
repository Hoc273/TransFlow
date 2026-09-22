package com.app.modules.provider.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.provider.service.TtsVoicePreviewRateLimiter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.UUID;

/**
 * Per-user fixed-window limit for TTS voice preview — Redis INCR, same mechanism as
 * {@code BatchCreateRateLimiterImpl}. Fail-open on Redis errors (same policy as
 * transflow's VoicePreviewRateLimiter).
 */
@Service
public class TtsVoicePreviewRateLimiterImpl implements TtsVoicePreviewRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(TtsVoicePreviewRateLimiterImpl.class);
    private static final String KEY_PREFIX = "tts-voice-preview:";

    private final StringRedisTemplate redis;
    private final int maxRequests;
    private final Duration window;

    public TtsVoicePreviewRateLimiterImpl(
            StringRedisTemplate redis,
            @Value("${app.rate-limit.voice-preview.max-requests:5}") int maxRequests,
            @Value("${app.rate-limit.voice-preview.window-seconds:60}") long windowSeconds) {
        this.redis = redis;
        this.maxRequests = maxRequests;
        this.window = Duration.ofSeconds(windowSeconds);
    }

    @Override
    public void check(UUID userId) {
        String key = KEY_PREFIX + userId;
        try {
            Long count = redis.opsForValue().increment(key);
            if (count != null && count == 1L) {
                redis.expire(key, window);
            }
            if (count != null && count > maxRequests) {
                throw new AppException(ErrorCode.TTS_PREVIEW_RATE_LIMIT_EXCEEDED);
            }
        } catch (AppException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            log.warn("TTS preview rate limit check failed; allowing request: {}", ex.toString());
        }
    }
}
