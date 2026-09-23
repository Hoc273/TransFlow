package com.app.modules.platform.service.impl;

import com.app.modules.platform.entity.PlatformAdminAuditAction;
import com.app.modules.platform.entity.PlatformAdminAuditLog;
import com.app.modules.platform.repository.PlatformAdminAuditLogRepository;
import com.app.modules.platform.service.PlatformAdminAuditService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class PlatformAdminAuditServiceImpl implements PlatformAdminAuditService {

    private static final Logger log = LoggerFactory.getLogger(PlatformAdminAuditServiceImpl.class);
    private static final int MAX_QUERY = 1024;
    private static final int MAX_UA = 512;
    private static final int MAX_PATH = 512;

    private final PlatformAdminAuditLogRepository repository;

    public PlatformAdminAuditServiceImpl(PlatformAdminAuditLogRepository repository) {
        this.repository = repository;
    }

    /**
     * Private write helper — intentionally NOT transactional on its own: it runs
     * inside the {@code REQUIRES_NEW} transaction of the public entry points.
     * A {@code @Transactional} annotation here would be ignored anyway on
     * self-invocation (Spring proxy) and mislead about the real tx boundary.
     * Commit-time failures still escape to the caller — the audit filter
     * catches them (audit must never break the request path).
     */
    private void writeRow(UUID actorUserId,
                          PlatformAdminAuditAction action,
                          String httpMethod,
                          String path,
                          String queryString,
                          String ip,
                          String userAgent,
                          int statusCode) {
        try {
            PlatformAdminAuditLog row = new PlatformAdminAuditLog();
            row.setActorUserId(actorUserId);
            row.setAction(action);
            row.setHttpMethod(truncate(httpMethod, 10));
            row.setPath(truncate(path, MAX_PATH));
            row.setQueryString(truncate(queryString, MAX_QUERY));
            row.setIp(truncate(ip, 64));
            row.setUserAgent(truncate(userAgent, MAX_UA));
            row.setStatusCode(statusCode);
            repository.save(row);
        } catch (Exception ex) {
            // Save-time failure: drop the row, keep going.
            log.warn("platform_admin_audit_write_failed action={} path={}: {}",
                    action, path, ex.toString());
        }
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFromRequest(UUID actorUserId,
                                  PlatformAdminAuditAction action,
                                  HttpServletRequest request,
                                  int statusCode) {
        writeRow(actorUserId,
                action,
                request.getMethod(),
                request.getRequestURI(),
                request.getQueryString(),
                clientIp(request),
                request.getHeader("User-Agent"),
                statusCode);
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void seedGrant(UUID grantedUserId) {
        writeRow(null,
                PlatformAdminAuditAction.SEED_GRANT,
                "SYSTEM",
                "/internal/platform-admin/seed",
                "userId=" + grantedUserId,
                null,
                null,
                200);
    }

    public static PlatformAdminAuditAction actionForPath(String path) {
        if (path == null) {
            return PlatformAdminAuditAction.OTHER;
        }
        if (path.contains("/overview")) {
            return PlatformAdminAuditAction.VIEW_OVERVIEW;
        }
        if (path.contains("/status")) {
            return PlatformAdminAuditAction.VIEW_STATUS;
        }
        if (path.contains("/audit-logs")) {
            return PlatformAdminAuditAction.LIST_AUDIT;
        }
        if (path.contains("/workspaces")) {
            return PlatformAdminAuditAction.LIST_WORKSPACES;
        }
        if (path.contains("/users/") && path.endsWith("/credit/adjust")) {
            return PlatformAdminAuditAction.ADJUST_USER_CREDIT;
        }
        if (path.contains("/users/") && path.endsWith("/credit/balance")) {
            return PlatformAdminAuditAction.VIEW_USER_CREDIT;
        }
        if (path.contains("/users")) {
            return PlatformAdminAuditAction.LIST_USERS;
        }
        return PlatformAdminAuditAction.OTHER;
    }

    /**
     * Client IP for the audit row. Trusts {@code X-Forwarded-For} — only safe
     * because deployments are expected behind a trusted reverse proxy that
     * overwrites the header; without one, a caller can spoof this field.
     */
    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return comma > 0 ? forwarded.substring(0, comma).trim() : forwarded.trim();
        }
        return request.getRemoteAddr();
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
