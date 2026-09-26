package com.app.modules.auth.service;

import com.app.common.config.SecurityProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.common.security.FixedWindowRateLimiter;
import org.springframework.stereotype.Service;

/**
 * Per-account lock-out: after {@code app.security.login.max-failures} wrong passwords within
 * {@code lock-duration}, further attempts on that email are refused until the window expires —
 * even with the right password — so online guessing is capped regardless of the attacker's IP.
 */
@Service
public class LoginAttemptService {

    private static final String KEY_PREFIX = "auth:login:fail:";

    private final FixedWindowRateLimiter limiter;
    private final SecurityProperties.Login cfg;

    public LoginAttemptService(FixedWindowRateLimiter limiter, SecurityProperties props) {
        this.limiter = limiter;
        this.cfg = props.login();
    }

    public void ensureNotLocked(String email) {
        if (limiter.peek(key(email)) >= cfg.maxFailures()) {
            throw new AppException(ErrorCode.LOGIN_TEMPORARILY_LOCKED);
        }
    }

    public void recordFailure(String email) {
        limiter.hit(key(email), cfg.lockDuration());
    }

    public void recordSuccess(String email) {
        limiter.reset(key(email));
    }

    private static String key(String email) {
        return KEY_PREFIX + EmailNormalizer.normalize(email);
    }
}
