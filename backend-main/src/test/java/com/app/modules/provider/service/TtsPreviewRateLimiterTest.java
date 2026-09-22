package com.app.modules.provider.service;

import com.app.modules.provider.service.impl.TtsPreviewRateLimiterImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TtsPreviewRateLimiterTest {

    @Mock
    private StringRedisTemplate redis;

    @Mock
    private ValueOperations<String, String> valueOps;

    private TtsPreviewRateLimiter limiter;

    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        limiter = new TtsPreviewRateLimiterImpl(redis, 20, 600);
        when(redis.opsForValue()).thenReturn(valueOps);
    }

    @Test
    void testUnderLimitIsNotRateLimited() {
        when(valueOps.increment("tts:preview:" + userId)).thenReturn(3L);

        assertFalse(limiter.isRateLimited(userId));
    }

    @Test
    void testFirstAttemptSetsWindowExpiry() {
        when(valueOps.increment("tts:preview:" + userId)).thenReturn(1L);

        assertFalse(limiter.isRateLimited(userId));
        verify(redis).expire("tts:preview:" + userId, Duration.ofSeconds(600));
    }

    @Test
    void testOverLimitIsRateLimited() {
        when(valueOps.increment("tts:preview:" + userId)).thenReturn(21L);

        assertTrue(limiter.isRateLimited(userId));
    }

    @Test
    void testExactlyAtLimitIsNotRateLimited() {
        when(valueOps.increment("tts:preview:" + userId)).thenReturn(20L);

        assertFalse(limiter.isRateLimited(userId));
    }
}
