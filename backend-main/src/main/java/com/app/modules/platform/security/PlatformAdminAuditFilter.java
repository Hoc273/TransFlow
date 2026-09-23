package com.app.modules.platform.security;

import com.app.common.security.AuthenticatedUser;
import com.app.modules.platform.entity.PlatformAdminAuditAction;
import com.app.modules.platform.service.PlatformAdminAuditService;
import com.app.modules.platform.service.impl.PlatformAdminAuditServiceImpl;
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

/**
 * Writes access audit rows for every {@code /api/platform/**} request, including
 * DENIED ones (401 no JWT / 403 non-admin — SRS §5.8). Registered after
 * {@code JwtAuthFilter} in {@code SecurityConfig} so the principal is populated.
 *
 * <p>Not a {@code @Component} on purpose: a filter bean would ALSO be registered
 * in the servlet container (running before the security chain, when the
 * SecurityContext is already cleared) and would double-write audit rows.
 * {@code SecurityConfig} instantiates it directly for the security chain only.
 *
 * <p>Authorization itself stays at the service layer
 * ({@code PlatformAdminAccessService.requirePlatformAdmin}) — this filter is
 * audit-only and never blocks a request. Any failure inside the audit write
 * (including commit-time {@code TransactionSystemException} from the
 * {@code REQUIRES_NEW} boundary, which escapes the service's own try-catch)
 * is swallowed here so it cannot corrupt an already-completed response.
 */
public class PlatformAdminAuditFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(PlatformAdminAuditFilter.class);
    private static final String PLATFORM_PREFIX = "/api/platform";

    private final PlatformAdminAuditService auditService;

    public PlatformAdminAuditFilter(PlatformAdminAuditService auditService) {
        this.auditService = auditService;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path == null
                || !(path.equals(PLATFORM_PREFIX) || path.startsWith(PLATFORM_PREFIX + "/"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {
        AuthenticatedUser principal = extractPrincipal();
        int status = 500;
        try {
            chain.doFilter(request, response);
            status = response.getStatus();
        } catch (Throwable t) {
            // The chain threw before the error dispatch mapped a status — record
            // the real outcome (500) instead of the stale 200 still on the
            // response, then let the original failure propagate unchanged.
            writeAudit(principal, request, 500);
            throw t;
        }
        writeAudit(principal, request, status);
    }

    private void writeAudit(AuthenticatedUser principal,
                            HttpServletRequest request,
                            int status) {
        try {
            // DENIED is reserved for auth rejections (401/403); other non-2xx
            // outcomes (e.g. 400 validation) still record the attempted action.
            PlatformAdminAuditAction action = (status == 401 || status == 403)
                    ? PlatformAdminAuditAction.DENIED
                    : PlatformAdminAuditServiceImpl.actionForPath(request.getRequestURI());
            auditService.recordFromRequest(
                    principal != null ? principal.id() : null, action, request, status);
        } catch (Throwable t) {
            // Audit must never break the request path — covers commit-time
            // failures that escape the service's REQUIRES_NEW boundary.
            log.warn("platform_admin_audit_failed path={} status={}: {}",
                    request.getRequestURI(), status, t.toString());
        }
    }

    private static AuthenticatedUser extractPrincipal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        Object p = authentication.getPrincipal();
        return p instanceof AuthenticatedUser user ? user : null;
    }
}
