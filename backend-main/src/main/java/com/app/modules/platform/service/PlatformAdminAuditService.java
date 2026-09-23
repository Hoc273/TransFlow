package com.app.modules.platform.service;

import com.app.modules.platform.entity.PlatformAdminAuditAction;
import jakarta.servlet.http.HttpServletRequest;

import java.util.UUID;

/**
 * Writes Super Admin access audit rows (SRS §5.8). Implementations must use a
 * new transaction so a denied/failed request still persists its audit entry,
 * and must never propagate errors back into the request path.
 */
public interface PlatformAdminAuditService {

    void recordFromRequest(UUID actorUserId,
                           PlatformAdminAuditAction action,
                           HttpServletRequest request,
                           int statusCode);

    /** System seed grant — actor null, action SEED_GRANT. */
    void seedGrant(UUID grantedUserId);
}
