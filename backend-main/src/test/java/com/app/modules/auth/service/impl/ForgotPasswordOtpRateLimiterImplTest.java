package com.app.modules.auth.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ForgotPasswordOtpRateLimiterImplTest {

    @Mock
    private StringRedisTemplate redis;

    @Mock
    private ValueOperations<String, String> valueOps;

    private ForgotPasswordOtpRateLimiterImpl limiter() {
        return new ForgotPasswordOtpRateLimiterImpl(redis, 5, 600);
    }

    @Test
    void check_underLimit_allows() {
        when(redis.opsForValue()).thenReturn(valueOps);
        when(valueOps.increment(anyString())).thenReturn(3L);

        assertDoesNotThrow(() -> limiter().check("user@transflow.com"));
    }

    @Test
    void check_overLimit_throws429() {
        when(redis.opsForValue()).thenReturn(valueOps);
        when(valueOps.increment(anyString())).thenReturn(6L);

        AppException ex = assertThrows(AppException.class, () -> limiter().check("user@transflow.com"));
        assertEquals(ErrorCode.OTP_RATE_LIMIT_EXCEEDED, ex.getErrorCode());
    }

    @Test
    void check_redisDown_failsOpen() {
        when(redis.opsForValue()).thenReturn(valueOps);
        when(valueOps.increment(anyString())).thenThrow(new RuntimeException("connection refused"));

        assertDoesNotThrow(() -> limiter().check("user@transflow.com"));
    }

    @Test
    void check_existingKeyWithoutTTL_reappliesExpire() {
        // Crash between INCR and EXPIRE leaves the key with TTL=-1 (never expires) —
        // the limiter must re-apply the window instead of permanently blocking the email.
        when(redis.opsForValue()).thenReturn(valueOps);
        when(valueOps.increment(anyString())).thenReturn(2L);
        when(redis.getExpire(anyString())).thenReturn(-1L);

        assertDoesNotThrow(() -> limiter().check("user@transflow.com"));
        verify(redis).expire(eq("auth:otp:forgot:rl:user@transflow.com"), any());
    }
}
