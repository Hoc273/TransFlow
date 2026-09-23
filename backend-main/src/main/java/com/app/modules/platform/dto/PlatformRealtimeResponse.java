package com.app.modules.platform.dto;

import java.time.Instant;

/**
 * {@code GET /api/platform/realtime} — live system activity snapshot polled every 3s.
 * All values sourced from DB, no mocks.
 */
public record PlatformRealtimeResponse(
        long processingJobs,
        long completedToday,
        long tokensLastHour,
        Instant checkedAt
) {}
