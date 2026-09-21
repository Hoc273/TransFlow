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
 */
@Component
public class ForgotPasswordOtpStore {

    private static final Logger log = LoggerFactory.getLogger(ForgotPasswordOtpStore.class);

    private static final String OTP_KEY_PREFIX = "auth:otp:forgot:";
    private static final String VERIFIED_KEY_PREFIX = "auth:otp:verified:";

    private static final Duration OTP_TTL = Duration.ofMinutes(5);
    private static final Duration VERIFIED_TTL = Duration.ofMinutes(10);

    private final StringRedisTemplate redis;

    private final Map<String, OtpEntry> fallbackOtps = new ConcurrentHashMap<>();
    private final Map<String, Instant> fallbackVerified = new ConcurrentHashMap<>();

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
            return;
        } catch (Exception ex) {
            log.debug("Redis not available for saveOtp, using fallback: {}", ex.getMessage());
        }
        fallbackOtps.put(cleanEmail, new OtpEntry(otp, Instant.now().plus(OTP_TTL)));
    }

    public boolean verifyOtp(String email, String otp) {
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

        if (stored != null && stored.trim().equals(otp.trim())) {
            // Mark as verified
            try {
                redis.opsForValue().set(VERIFIED_KEY_PREFIX + cleanEmail, "1", VERIFIED_TTL);
            } catch (Exception ex) {
                log.debug("Redis set verified failed, checking fallback: {}", ex.getMessage());
            }
            fallbackVerified.put(cleanEmail, Instant.now().plus(VERIFIED_TTL));
            return true;
        }

        return false;
    }

    public boolean consumeOtpOrVerified(String email, String otp) {
        String cleanEmail = normalize(email);
        boolean isValid = verifyOtp(cleanEmail, otp);
        if (!isValid) {
            // Check if already verified
            try {
                String v = redis.opsForValue().get(VERIFIED_KEY_PREFIX + cleanEmail);
                if ("1".equals(v)) {
                    isValid = true;
                }
            } catch (Exception ex) {
                log.debug("Redis check verified failed: {}", ex.getMessage());
            }
            if (!isValid) {
                Instant exp = fallbackVerified.get(cleanEmail);
                if (exp != null && exp.isAfter(Instant.now())) {
                    isValid = true;
                }
            }
        }

        if (isValid) {
            // Clean up
            try {
                redis.delete(OTP_KEY_PREFIX + cleanEmail);
                redis.delete(VERIFIED_KEY_PREFIX + cleanEmail);
            } catch (Exception ex) {
                log.debug("Redis delete failed: {}", ex.getMessage());
            }
            fallbackOtps.remove(cleanEmail);
            fallbackVerified.remove(cleanEmail);
            return true;
        }

        return false;
    }

    private record OtpEntry(String otp, Instant expiresAt) {}
}
