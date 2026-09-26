package com.app.modules.auth.service;

import com.app.common.config.SecurityProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.common.security.FixedWindowRateLimiter;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthSecurityPoliciesTest {

    // ---- EmailNormalizer ----

    @Test
    void canonicalize_collapsesGmailDotsPlusTagsAndGooglemail() {
        assertEquals("johndoe@gmail.com", EmailNormalizer.canonicalize("John.Doe+1@Gmail.com"));
        assertEquals("johndoe@gmail.com", EmailNormalizer.canonicalize(" j.o.h.n.doe+x+y@googlemail.com "));
        assertEquals("johndoe@gmail.com", EmailNormalizer.canonicalize("johndoe@gmail.com"));
    }

    @Test
    void canonicalize_otherDomainsOnlyDropPlusTagAndKeepDots() {
        assertEquals("john.doe@company.vn", EmailNormalizer.canonicalize("John.Doe+test@Company.vn"));
        assertEquals("+tag@company.vn", EmailNormalizer.canonicalize("+tag@company.vn"));
        assertEquals("no-at-sign", EmailNormalizer.canonicalize("no-at-sign"));
    }

    // ---- PasswordPolicy ----

    @Test
    void passwordPolicy_enforcesMinLengthAndBcryptByteLimit() {
        assertDoesNotThrow(() -> PasswordPolicy.requireAcceptable("Password123!"));
        assertDoesNotThrow(() -> PasswordPolicy.requireAcceptable("a".repeat(72)));
        assertEquals(ErrorCode.VALIDATION_ERROR,
                assertThrows(AppException.class, () -> PasswordPolicy.requireAcceptable("short")).getErrorCode());
        assertEquals(ErrorCode.VALIDATION_ERROR,
                assertThrows(AppException.class, () -> PasswordPolicy.requireAcceptable("a".repeat(73))).getErrorCode());
        // 25 chars but 75 UTF-8 bytes.
        assertFalse(PasswordPolicy.fitsBcrypt("ệ".repeat(25)));
    }

    // ---- AvatarPolicy ----

    @Test
    void avatarPolicy_acceptsRasterDataUrlsAndHttpsOnly() {
        assertEquals("data:image/png;base64,iVBORw0KGgo=", AvatarPolicy.sanitize(" data:image/png;base64,iVBORw0KGgo= "));
        assertEquals("https://cdn.example.com/a.png", AvatarPolicy.sanitize("https://cdn.example.com/a.png"));
        assertNull(AvatarPolicy.sanitize("   "));
        assertNull(AvatarPolicy.sanitize(null));
    }

    @Test
    void avatarPolicy_rejectsScriptableOrOversizedValues() {
        String[] bad = {
                "javascript:alert(1)",
                "data:image/svg+xml;base64,PHN2Zz4=",
                "data:text/html;base64,PGgxPg==",
                "data:image/png;base64,<script>",
                "http://example.com/a.png",
                "https://user:pw@example.com/a.png",
                "data:image/png;base64," + "A".repeat(AvatarPolicy.MAX_DATA_URL_CHARS),
        };
        for (String v : bad) {
            AppException ex = assertThrows(AppException.class, () -> AvatarPolicy.sanitize(v), v);
            assertEquals(ErrorCode.INVALID_AVATAR, ex.getErrorCode());
        }
    }

    // ---- LoginAttemptService (Redis down -> local fallback, never fail-open) ----

    @Test
    void loginAttempts_lockAfterMaxFailuresAndResetOnSuccess() {
        LoginAttemptService service = new LoginAttemptService(limiterWithRedisDown(), props(3));
        String email = "victim@transflow.com";

        for (int i = 0; i < 3; i++) {
            assertDoesNotThrow(() -> service.ensureNotLocked(email));
            service.recordFailure(email);
        }
        AppException ex = assertThrows(AppException.class, () -> service.ensureNotLocked("VICTIM@transflow.com "));
        assertEquals(ErrorCode.LOGIN_TEMPORARILY_LOCKED, ex.getErrorCode());

        service.recordSuccess(email);
        assertDoesNotThrow(() -> service.ensureNotLocked(email));
    }

    @Test
    void rateLimiter_localFallbackWindowExpires() throws InterruptedException {
        FixedWindowRateLimiter limiter = limiterWithRedisDown();
        assertEquals(1, limiter.hit("k", Duration.ofMillis(50)));
        assertEquals(2, limiter.hit("k", Duration.ofMillis(50)));
        Thread.sleep(80);
        assertEquals(0, limiter.peek("k"));
        assertEquals(1, limiter.hit("k", Duration.ofMillis(50)));
    }

    static FixedWindowRateLimiter limiterWithRedisDown() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.opsForValue()).thenThrow(new RedisConnectionFailureException("down"));
        when(redis.delete(anyString())).thenThrow(new RedisConnectionFailureException("down"));
        return new FixedWindowRateLimiter(redis);
    }

    private static SecurityProperties props(int maxFailures) {
        return new SecurityProperties(false, false, null, null,
                new SecurityProperties.Login(maxFailures, Duration.ofMinutes(15)), null);
    }
}
