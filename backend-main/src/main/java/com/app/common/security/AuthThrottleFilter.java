package com.app.common.security;

import com.app.common.config.SecurityProperties;
import com.app.common.dto.ApiResponse;
import com.app.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Set;

/**
 * Per-client-IP budget on the unauthenticated auth endpoints that bots hammer
 * (credential stuffing, sign-up spam, OTP mail-bombing). Complements the per-account
 * lock-out in {@code LoginAttemptService}, which alone cannot stop one IP spraying many emails.
 * {@code /refresh} and {@code /logout} are excluded — legitimate sessions call them routinely.
 * <p>
 * The client IP is {@code getRemoteAddr()}: with {@code server.forward-headers-strategy=native}
 * Tomcat only honours X-Forwarded-For from trusted (private-range) proxies, so it can't be spoofed.
 */
public class AuthThrottleFilter extends OncePerRequestFilter {

    private static final String KEY_PREFIX = "auth:ip:";
    private static final Set<String> THROTTLED_PREFIXES = Set.of(
            "/api/auth/login",
            "/api/auth/register",
            "/api/auth/forgot-password/",
            "/api/auth/google/exchange");

    private final FixedWindowRateLimiter limiter;
    private final SecurityProperties.AuthThrottle cfg;
    private final ObjectMapper objectMapper;

    public AuthThrottleFilter(FixedWindowRateLimiter limiter, SecurityProperties props, ObjectMapper objectMapper) {
        this.limiter = limiter;
        this.cfg = props.authThrottle();
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        if (!"POST".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return THROTTLED_PREFIXES.stream().noneMatch(path::startsWith);
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        long count = limiter.hit(KEY_PREFIX + request.getRemoteAddr(), cfg.window());
        if (count > cfg.maxRequests()) {
            response.setStatus(ErrorCode.TOO_MANY_REQUESTS.getHttpStatusCode().value());
            response.setHeader("Retry-After", String.valueOf(cfg.window().toSeconds()));
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            objectMapper.writeValue(response.getWriter(), ApiResponse.builder()
                    .code(ErrorCode.TOO_MANY_REQUESTS.getCode())
                    .message(ErrorCode.TOO_MANY_REQUESTS.getMessage())
                    .build());
            return;
        }
        chain.doFilter(request, response);
    }
}
