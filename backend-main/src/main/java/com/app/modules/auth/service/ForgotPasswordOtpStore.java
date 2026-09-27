package com.app.modules.auth.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Redis-backed OTP storage for Forgot Password with in-memory fallback resilience.
 *
 * <p>OTP is stored in plain text under a short TTL (5 minutes) — accepted trade-off,
 * see BACKEND_MISSING_TASKS §8 notes. Failed verify/reset attempts are counted;
 * after {@link #MAX_ATTEMPTS} wrong tries the OTP is deleted.
 */
@Component
public class ForgotPasswordOtpStore {

    private static final Logger log = LoggerFactory.getLogger(ForgotPasswordOtpStore.class);

    private static final String OTP_KEY_PREFIX = "auth:otp:forgot:";
    private static final String ATTEMPTS_KEY_PREFIX = "auth:otp:forgot:att:";

    private static final Duration OTP_TTL = Duration.ofMinutes(5);
    private static final int MAX_ATTEMPTS = 5;

    private final StringRedisTemplate redis;

    private final Map<String, OtpEntry> fallbackOtps = new ConcurrentHashMap<>();
    private final Map<String, AttemptEntry> fallbackAttempts = new ConcurrentHashMap<>();

    public ForgotPasswordOtpStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    private String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    public void saveOtp(String email, String otp) {
        String cleanEmail = normalize(email);
        try {
            redis.opsForValue().set(OTP_KEY_PREFIX + cleanEmail, otp, OTP_TTL);
            redis.delete(ATTEMPTS_KEY_PREFIX + cleanEmail);
            return;
        } catch (Exception ex) {
            log.debug("Redis not available for saveOtp, using fallback: {}", ex.getMessage());
        }
        fallbackOtps.put(cleanEmail, new OtpEntry(otp, Instant.now().plus(OTP_TTL)));
        fallbackAttempts.remove(cleanEmail);
    }

    /**
     * Checks the OTP without consuming it (used by /verify). Wrong attempts are counted;
     * the OTP is deleted after {@link #MAX_ATTEMPTS} failures.
     */
    public boolean verifyOtp(String email, String otp) {
        return checkOtp(email, otp, false);
    }

    /**
     * Checks the OTP and deletes it on match (used by /reset). Wrong attempts are counted
     * the same way as {@link #verifyOtp}.
     */
    public boolean consumeOtp(String email, String otp) {
        return checkOtp(email, otp, true);
    }

    private boolean checkOtp(String email, String otp, boolean consume) {
        String cleanEmail = normalize(email);
        if (cleanEmail.isBlank() || otp == null || otp.isBlank()) {
            return false;
        }

        String stored = null;
        try {
            stored = redis.opsForValue().get(OTP_KEY_PREFIX + cleanEmail);
        } catch (Exception ex) {
            log.debug("Redis get OTP failed, checking fallback: {}", ex.getMessage());
        }

        if (stored == null) {
            OtpEntry entry = fallbackOtps.get(cleanEmail);
            if (entry != null && entry.expiresAt().isAfter(Instant.now())) {
                stored = entry.otp();
            }
        }

        if (stored == null) {
            return false;
        }

        if (!stored.trim().equals(otp.trim())) {
            registerFailedAttempt(cleanEmail);
            return false;
        }

        if (consume) {
            try {
                redis.delete(OTP_KEY_PREFIX + cleanEmail);
                redis.delete(ATTEMPTS_KEY_PREFIX + cleanEmail);
            } catch (Exception ex) {
                log.debug("Redis delete failed: {}", ex.getMessage());
            }
            fallbackOtps.remove(cleanEmail);
            fallbackAttempts.remove(cleanEmail);
        }
        return true;
    }

    private void registerFailedAttempt(String cleanEmail) {
        try {
            String key = ATTEMPTS_KEY_PREFIX + cleanEmail;
            Long count = redis.opsForValue().increment(key);
            // Re-apply TTL if the key was left without one (crash between INCR and EXPIRE).
            Long ttl = redis.getExpire(key);
            if (count != null && (count == 1L || ttl == null || ttl < 0)) {
                redis.expire(key, OTP_TTL);
            }
            if (count != null && count >= MAX_ATTEMPTS) {
                redis.delete(OTP_KEY_PREFIX + cleanEmail);
                redis.delete(key);
            }
            return;
        } catch (Exception ex) {
            log.debug("Redis attempts counter failed, using fallback: {}", ex.getMessage());
        }

        AttemptEntry entry = fallbackAttempts.compute(cleanEmail,
                (k, cur) -> cur == null || cur.expiresAt().isBefore(Instant.now())
                        ? new AttemptEntry(1, Instant.now().plus(OTP_TTL))
                        : new AttemptEntry(cur.count() + 1, cur.expiresAt()));
        if (entry.count() >= MAX_ATTEMPTS) {
            fallbackOtps.remove(cleanEmail);
            fallbackAttempts.remove(cleanEmail);
        }
    }

    private record OtpEntry(String otp, Instant expiresAt) {}

    private record AttemptEntry(int count, Instant expiresAt) {}
}
