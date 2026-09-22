package com.app.modules.auth.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.service.ForgotPasswordOtpRateLimiter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Locale;

/**
 * Per-email fixed-window limit for forgot-password OTP sends — Redis INCR, same
 * mechanism as {@code TtsVoicePreviewRateLimiterImpl}. Fail-open on Redis errors.
 */
@Service
public class ForgotPasswordOtpRateLimiterImpl implements ForgotPasswordOtpRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(ForgotPasswordOtpRateLimiterImpl.class);
    private static final String KEY_PREFIX = "auth:otp:forgot:rl:";

    private final StringRedisTemplate redis;
    private final int maxRequests;
    private final Duration window;

    public ForgotPasswordOtpRateLimiterImpl(
            StringRedisTemplate redis,
            @Value("${app.rate-limit.forgot-password-otp.max-requests:5}") int maxRequests,
            @Value("${app.rate-limit.forgot-password-otp.window-seconds:600}") long windowSeconds) {
        this.redis = redis;
        this.maxRequests = maxRequests;
        this.window = Duration.ofSeconds(windowSeconds);
    }

    @Override
    public void check(String email) {
        String cleanEmail = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        String key = KEY_PREFIX + cleanEmail;
        try {
            Long count = redis.opsForValue().increment(key);
            // Re-apply TTL if the key was left without one (crash between INCR and EXPIRE).
            Long ttl = redis.getExpire(key);
            if (count != null && (count == 1L || ttl == null || ttl < 0)) {
                redis.expire(key, window);
            }
            if (count != null && count > maxRequests) {
                throw new AppException(ErrorCode.OTP_RATE_LIMIT_EXCEEDED);
            }
        } catch (AppException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            log.warn("Forgot-password OTP rate limit check failed; allowing request: {}", ex.toString());
        }
    }
}
