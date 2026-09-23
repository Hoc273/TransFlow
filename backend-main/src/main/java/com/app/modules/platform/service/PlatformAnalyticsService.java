package com.app.modules.platform.service;

import com.app.modules.platform.dto.PlatformOverviewResponse;

import java.time.Instant;
import java.util.UUID;

/**
 * Cross-tenant Super Admin analytics (API_Contract.md §13.1). Aggregate only —
 * never returns content text.
 */
public interface PlatformAnalyticsService {

    /**
     * @param from    range start (inclusive); null defaults to {@code to} minus 7 days
     * @param to      range end (exclusive); null defaults to now
     * @param topLimit top-workspaces limit; null/<=0 defaults to 10, clamped to 50
     */
    PlatformOverviewResponse overview(UUID callerId, Instant from, Instant to, Integer topLimit);
}
