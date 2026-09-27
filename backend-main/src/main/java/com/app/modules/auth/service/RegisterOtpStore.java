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
 * Redis-backed OTP storage for Registration email verification with in-memory fallback.
 */
@Component
public class RegisterOtpStore {

    private static final Logger log = LoggerFactory.getLogger(RegisterOtpStore.class);

    private static final String OTP_KEY_PREFIX = "auth:otp:register:";
    private static final Duration OTP_TTL = Duration.ofMinutes(5);

    private final StringRedisTemplate redis;
    private final Map<String, OtpEntry> fallbackOtps = new ConcurrentHashMap<>();

    public RegisterOtpStore(StringRedisTemplate redis) {
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
            log.debug("Redis not available for saveOtp (register), using fallback: {}", ex.getMessage());
        }
        fallbackOtps.put(cleanEmail, new OtpEntry(otp, Instant.now().plus(OTP_TTL)));
    }

    public boolean hasOtp(String email) {
        String cleanEmail = normalize(email);
        if (cleanEmail.isBlank()) {
            return false;
        }
        try {
            Boolean hasKey = redis.hasKey(OTP_KEY_PREFIX + cleanEmail);
            if (Boolean.TRUE.equals(hasKey)) {
                return true;
            }
        } catch (Exception ex) {
            log.debug("Redis hasKey failed, checking fallback: {}", ex.getMessage());
        }
        OtpEntry entry = fallbackOtps.get(cleanEmail);
        return entry != null && entry.expiresAt().isAfter(Instant.now());
    }

    public boolean verifyAndConsumeOtp(String email, String otp) {
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
            // Cleanup immediately on success
            try {
                redis.delete(OTP_KEY_PREFIX + cleanEmail);
            } catch (Exception ex) {
                log.debug("Redis delete failed: {}", ex.getMessage());
            }
            fallbackOtps.remove(cleanEmail);
            return true;
        }

        return false;
    }

    private record OtpEntry(String otp, Instant expiresAt) {}
}
