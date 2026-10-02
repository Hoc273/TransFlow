package com.app.modules.platform.security;

import com.app.common.security.AuthenticatedUser;
import com.app.modules.platform.service.UserActivityLogService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Set;
import java.util.UUID;

/**
 * Records regular-user activity: every authenticated POST/PUT/PATCH/DELETE under {@code /api},
 * and failed logins. Reads are not logged (job polling every ~5s would flood the table), and
 * {@code /api/platform/**} has its own audit ({@code PlatformAdminAuditFilter}).
 *
 * <p>Same wiring rules as {@code PlatformAdminAuditFilter}: instantiated by {@code SecurityConfig}
 * (not a bean, so it is not registered twice), runs after JWT auth, never blocks or breaks a request.
 */
public class UserActivityLogFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(UserActivityLogFilter.class);
    private static final Set<String> WRITE_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");
    private static final String LOGIN_PATH = "/api/auth/login";

    private final UserActivityLogService activityLogService;

    public UserActivityLogFilter(UserActivityLogService activityLogService) {
        this.activityLogService = activityLogService;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (path == null || !path.startsWith("/api/") || !WRITE_METHODS.contains(request.getMethod())) {
            return true;
        }
        return isHighVolume(path);
    }

    /** Admin paths are audited elsewhere; the rest fire many times per session and carry no intent. */
    static boolean isHighVolume(String path) {
        return path.startsWith("/api/platform/")
                || path.equals("/api/presence/heartbeat")
                || path.equals("/api/auth/refresh")
                || path.matches("^/api/workspaces/[^/]+/media/uploads/[^/]+/chunks/\\d+$")
                || path.endsWith("/read") || path.endsWith("/read-all");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        int status = 500;
        try {
            chain.doFilter(request, response);
            status = response.getStatus();
        } finally {
            write(request, status);
        }
    }

    private void write(HttpServletRequest request, int status) {
        try {
            UUID userId = currentUserId();
            boolean failedLogin = LOGIN_PATH.equals(request.getRequestURI()) && status >= 400;
            if (userId == null && !failedLogin) {
                return; // other unauthenticated calls (register, password reset) are not tied to a user
            }
            activityLogService.record(userId, request, status);
        } catch (Throwable t) {
            log.warn("user_activity_log_failed path={} status={}: {}", request.getRequestURI(), status, t.toString());
        }
    }

    private static UUID currentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        return authentication.getPrincipal() instanceof AuthenticatedUser user ? user.id() : null;
    }
}
