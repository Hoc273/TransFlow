package com.app.modules.platform.service.impl;

import com.app.modules.platform.service.UserPresenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Redis ZSET-backed presence store.
 *
 * <p>Key {@code platform:presence:online} maps userId -&gt; last heartbeat epoch
 * second. Stale entries (older than the online window) are pruned on every
 * read, and multiple tabs of the same user collapse into one member.
 * Falls back to in-memory state if Redis is unavailable.
 */
@Component
public class UserPresenceServiceImpl implements UserPresenceService {

    private static final Logger log = LoggerFactory.getLogger(UserPresenceServiceImpl.class);

    private static final String KEY = "platform:presence:online";
    private static final Duration ONLINE_WINDOW = Duration.ofSeconds(120);

    private final StringRedisTemplate redis;

    // In-memory fallback (per instance)
    private final Map<UUID, Long> fallback = new ConcurrentHashMap<>();

    public UserPresenceServiceImpl(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public void heartbeat(UUID userId) {
        if (userId == null) {
            return;
        }
        long now = Instant.now().getEpochSecond();
        try {
            redis.opsForZSet().add(KEY, userId.toString(), now);
            return;
        } catch (Exception ex) {
            log.debug("Redis not available for presence heartbeat, using in-memory store: {}", ex.getMessage());
        }
        fallback.put(userId, now);
    }

    @Override
    public long countOnline() {
        long cutoff = Instant.now().minus(ONLINE_WINDOW).getEpochSecond();
        try {
            redis.opsForZSet().removeRangeByScore(KEY, 0, cutoff);
            Long size = redis.opsForZSet().zCard(KEY);
            return size != null ? size : 0;
        } catch (Exception ex) {
            log.debug("Redis not available for presence count, using in-memory store: {}", ex.getMessage());
        }
        fallback.entrySet().removeIf(e -> e.getValue() <= cutoff);
        return fallback.size();
    }
}
