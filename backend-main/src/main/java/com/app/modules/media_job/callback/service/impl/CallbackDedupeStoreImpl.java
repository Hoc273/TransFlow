package com.app.modules.media_job.callback.service.impl;

import com.app.modules.media_job.callback.service.CallbackDedupeStore;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
public class CallbackDedupeStoreImpl implements CallbackDedupeStore {

    // Long enough to outlive any realistic retry window from the worker; short enough not to grow unbounded.
    private static final Duration TTL = Duration.ofHours(24);
    private static final String KEY_PREFIX = "media_job:callback:dedupe:";

    private final StringRedisTemplate redis;

    public CallbackDedupeStoreImpl(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public boolean isProcessed(String dedupeKey) {
        return Boolean.TRUE.equals(redis.hasKey(KEY_PREFIX + dedupeKey));
    }

    @Override
    public void markProcessed(String dedupeKey) {
        redis.opsForValue().set(KEY_PREFIX + dedupeKey, "1", TTL);
    }
}
