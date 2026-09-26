package com.app.modules.auth.service;

import com.app.common.config.AppProperties;
import com.app.common.config.SecurityProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Optional;

/**
 * Refresh token transport: an HttpOnly + Secure + SameSite=Strict cookie scoped to
 * {@code /api/auth}, so page JavaScript (and any XSS) can never read it and it is not
 * attached to cross-site requests. The access token stays short-lived in memory/body.
 */
@Component
public class AuthCookieService {

    private final SecurityProperties.RefreshCookie cfg;
    private final Duration maxAge;

    public AuthCookieService(SecurityProperties securityProps, AppProperties appProps) {
        this.cfg = securityProps.refreshCookie();
        this.maxAge = Duration.ofDays(appProps.jwt().refreshTtlDays());
    }

    public void writeRefreshCookie(HttpServletResponse response, String refreshToken) {
        response.addHeader(HttpHeaders.SET_COOKIE, build(refreshToken, maxAge).toString());
    }

    public void clearRefreshCookie(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, build("", Duration.ZERO).toString());
    }

    public Optional<String> readRefreshCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return Optional.empty();
        }
        for (Cookie c : cookies) {
            if (cfg.name().equals(c.getName()) && c.getValue() != null && !c.getValue().isBlank()) {
                return Optional.of(c.getValue());
            }
        }
        return Optional.empty();
    }

    private ResponseCookie build(String value, Duration age) {
        return ResponseCookie.from(cfg.name(), value)
                .httpOnly(true)
                .secure(cfg.secure())
                .sameSite(cfg.sameSite())
                .path(cfg.path())
                .maxAge(age)
                .build();
    }
}
