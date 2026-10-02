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
    LIST_CREDIT_PURCHASES,
    /** Approve or reject of a credit package purchase. */
    REVIEW_CREDIT_PURCHASE,
    SEED_GRANT,
    LIST_PROVIDERS,
    /** Create, update, delete, test or voice sync of a shared platform key. */
    MANAGE_PROVIDERS,
    /** List, history or coverage of the credit price table. */
    VIEW_PRICING,
    /** New credit price version (x, y). */
    CREATE_PRICING,
    PREVIEW_PRICING,
    /** Request was rejected by auth (401 unauthenticated / 403 non-admin). */
    DENIED,
    /** Any other {@code /api/platform/*} path not mapped to a specific action. */
    OTHER
}
