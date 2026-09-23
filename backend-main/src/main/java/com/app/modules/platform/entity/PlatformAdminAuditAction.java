package com.app.modules.platform.entity;

/**
 * Actions recorded in {@code platform_admin_audit_logs} (API_Contract.md §13.1).
 */
public enum PlatformAdminAuditAction {
    VIEW_OVERVIEW,
    VIEW_STATUS,
    LIST_USERS,
    LIST_WORKSPACES,
    LIST_AUDIT,
    VIEW_USER_CREDIT,
    ADJUST_USER_CREDIT,
    SEED_GRANT,
    /** Request was rejected by auth (401 unauthenticated / 403 non-admin). */
    DENIED,
    /** Any other {@code /api/platform/*} path not mapped to a specific action. */
    OTHER
}
