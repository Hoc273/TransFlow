package com.app.common.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Fixed-window counter shared by the security rate limits (login lock-out, per-IP auth throttle).
 * Redis INCR is the primary store; when Redis is unreachable it falls back to an in-process map
 * (single-instance deployment) instead of failing open, so brute force stays bounded during an outage.
 */
@Component
public class FixedWindowRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(FixedWindowRateLimiter.class);
    private static final int LOCAL_MAX_KEYS = 50_000;

    private final StringRedisTemplate redis;
    private final ConcurrentHashMap<String, LocalWindow> local = new ConcurrentHashMap<>();

    public FixedWindowRateLimiter(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** Increments the counter for {@code key} and returns the count within the current window. */
    public long hit(String key, Duration window) {
        try {
            Long count = redis.opsForValue().increment(key);
            // Re-apply TTL if the key was left without one (crash between INCR and EXPIRE).
            Long ttl = redis.getExpire(key);
            if (count != null && (count == 1L || ttl == null || ttl < 0)) {
                redis.expire(key, window);
            }
            if (count != null) {
                return count;
            }
        } catch (RuntimeException ex) {
            log.debug("Rate limiter falling back to local store: {}", ex.toString());
        }
        return hitLocal(key, window);
    }

    /** Current count without incrementing (0 when absent or expired). */
    public long peek(String key) {
        try {
            String v = redis.opsForValue().get(key);
            if (v != null) {
                return Long.parseLong(v);
            }
        } catch (RuntimeException ex) {
            log.debug("Rate limiter peek falling back to local store: {}", ex.toString());
        }
        LocalWindow w = local.get(key);
        return (w == null || w.expired()) ? 0 : w.count;
    }

    public void reset(String key) {
        try {
            redis.delete(key);
        } catch (RuntimeException ex) {
            log.debug("Rate limiter reset falling back to local store: {}", ex.toString());
        }
        local.remove(key);
    }

    private long hitLocal(String key, Duration window) {
        if (local.size() > LOCAL_MAX_KEYS) {
            local.entrySet().removeIf(e -> e.getValue().expired());
        }
        LocalWindow w = local.compute(key, (k, cur) ->
                (cur == null || cur.expired()) ? new LocalWindow(Instant.now().plus(window)) : cur);
        synchronized (w) {
            return ++w.count;
        }
    }

    private static final class LocalWindow {
        private final Instant expiresAt;
        private long count;

        LocalWindow(Instant expiresAt) {
            this.expiresAt = expiresAt;
        }

        boolean expired() {
            return Instant.now().isAfter(expiresAt);
        }
    }
}
