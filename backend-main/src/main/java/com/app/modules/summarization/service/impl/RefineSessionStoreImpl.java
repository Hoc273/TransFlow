package com.app.modules.summarization.service.impl;

import com.app.modules.summarization.service.RefineSessionStore;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.UUID;

@Service
public class RefineSessionStoreImpl implements RefineSessionStore {

    private static final Duration SESSION_TTL = Duration.ofMinutes(30);
    private static final String KEY_PREFIX = "summarization:refine:";

    private final StringRedisTemplate redis;

    public RefineSessionStoreImpl(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public int incrementAndGet(UUID mediaJobId) {
        String key = KEY_PREFIX + mediaJobId;
        Long count = redis.opsForValue().increment(key);
        if (count != null && count == 1L) {
            redis.expire(key, SESSION_TTL);
        }
        return count == null ? 1 : count.intValue();
    }
}
