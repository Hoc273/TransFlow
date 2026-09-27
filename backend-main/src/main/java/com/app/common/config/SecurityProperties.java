package com.app.common.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Binding for {@code app.security.*} — hardening knobs that are not business config.
 * Every field has a safe default so tests and local dev need no extra configuration.
 */
@ConfigurationProperties(prefix = "app.security")
public record SecurityProperties(
        /** Refuse to start when a known dev/default secret is still configured. */
        boolean strictSecrets,
        /** Redirect plain-HTTP API traffic to HTTPS (behind a TLS-terminating proxy). */
        boolean requireHttps,
        /** Shared token sent as {@code X-Internal-Token} to backend-ai and the media worker. */
        String internalServiceToken,
        RefreshCookie refreshCookie,
        Login login,
        AuthThrottle authThrottle
) {
    public SecurityProperties {
        if (refreshCookie == null) {
            refreshCookie = new RefreshCookie(null, true, null, null);
        }
        if (login == null) {
            login = new Login(0, null);
        }
        if (authThrottle == null) {
            authThrottle = new AuthThrottle(0, null);
        }
    }

    /** HttpOnly cookie that carries the refresh token (never exposed to JavaScript). */
    public record RefreshCookie(String name, boolean secure, String sameSite, String path) {
        public RefreshCookie {
            if (name == null || name.isBlank()) {
                name = "tf_refresh";
            }
            if (sameSite == null || sameSite.isBlank()) {
                sameSite = "Strict";
            }
            if (path == null || path.isBlank()) {
                path = "/api/auth";
            }
        }
    }

    /** Per-account lock-out after repeated failed password checks. */
    public record Login(int maxFailures, Duration lockDuration) {
        public Login {
            if (maxFailures <= 0) {
                maxFailures = 5;
            }
            if (lockDuration == null || lockDuration.isNegative() || lockDuration.isZero()) {
                lockDuration = Duration.ofMinutes(15);
            }
        }
    }

    /** Per-client-IP throttle on the public auth endpoints (bot / credential-stuffing guard). */
    public record AuthThrottle(int maxRequests, Duration window) {
        public AuthThrottle {
            if (maxRequests <= 0) {
                maxRequests = 30;
            }
            if (window == null || window.isNegative() || window.isZero()) {
                window = Duration.ofMinutes(5);
            }
        }
    }
}
