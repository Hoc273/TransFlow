package com.app.modules.platform.dto;

/** Status breakdown for one job type in the Super Admin overview (API_Contract.md §13.1). */
public record JobStatusCounts(
        long created,
        long completed,
        long failed,
        long processing,
        long other
) {
    public static JobStatusCounts empty() {
        return new JobStatusCounts(0, 0, 0, 0, 0);
    }

    public static JobStatusCounts of(long completed, long failed, long processing, long other) {
        long created = completed + failed + processing + other;
        return new JobStatusCounts(created, completed, failed, processing, other);
    }
}
