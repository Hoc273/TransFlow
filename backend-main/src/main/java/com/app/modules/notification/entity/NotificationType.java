package com.app.modules.notification.entity;

/**
 * Valid notification types as defined in Database_Design.md §10.
 * CHECK constraint: type IN ('JOB_COMPLETED','JOB_FAILED','JOB_NEEDS_RERUN','BATCH_COMPLETED','BATCH_PARTIALLY_FAILED','BATCH_FAILED')
 */
public enum NotificationType {
    JOB_COMPLETED,
    JOB_FAILED,
    JOB_NEEDS_RERUN,
    BATCH_COMPLETED,
    BATCH_PARTIALLY_FAILED,
    BATCH_FAILED
}
