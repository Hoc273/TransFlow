package com.app.modules.notification.entity;

/**
 * Valid notification types as defined in Database_Design.md §10.
 * CHECK constraint: type IN ('JOB_COMPLETED','JOB_FAILED','JOB_NEEDS_RERUN','JOB_QA_BLOCKED','BATCH_COMPLETED','BATCH_PARTIALLY_FAILED','BATCH_FAILED')
 */
public enum NotificationType {
    JOB_COMPLETED,
    JOB_FAILED,
    JOB_NEEDS_RERUN,
    /** RENDER is held by unresolved BLOCK_RENDER QA issues. */
    JOB_QA_BLOCKED,
    BATCH_COMPLETED,
    BATCH_PARTIALLY_FAILED,
    BATCH_FAILED
}
