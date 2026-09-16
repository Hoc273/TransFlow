package com.app.modules.batch.service.impl;

import com.app.modules.batch.service.BatchCreateRateLimiter;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.UUID;

/**
 * Default assumption (not pinned in SRS/Arch §14): 5 batch creations per user per 10-minute window.
 * Confirm with BA before relying on this exact threshold.
 */
@Service
public class BatchCreateRateLimiterImpl implements BatchCreateRateLimiter {

    private static final int MAX_CREATES_PER_WINDOW = 5;
    private static final Duration WINDOW = Duration.ofMinutes(10);
    private static final String KEY_PREFIX = "batch:create:";

    private final StringRedisTemplate redis;

    public BatchCreateRateLimiterImpl(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public boolean isRateLimited(UUID userId) {
        String key = KEY_PREFIX + userId;
        Long count = redis.opsForValue().increment(key);
        if (count != null && count == 1L) {
            redis.expire(key, WINDOW);
        }
        return count != null && count > MAX_CREATES_PER_WINDOW;
    }
}
