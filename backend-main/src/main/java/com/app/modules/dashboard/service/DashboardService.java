package com.app.modules.dashboard.service;

import com.app.modules.dashboard.dto.UsageSummaryResponse;
import com.app.modules.dashboard.dto.WorkspaceDashboardResponse;

import java.time.Instant;
import java.util.UUID;

/**
 * Dashboard service interface (API_Contract.md §10 & §13).
 */
public interface DashboardService {

    /**
     * Quick overview of jobs, batches, and remaining credit in the workspace.
     */
    WorkspaceDashboardResponse getDashboard(UUID workspaceId, UUID userId);

    /**
     * Aggregated AI usage statistics from ai_usage_logs.
     */
    UsageSummaryResponse getUsage(UUID workspaceId, UUID userId, String groupBy, Instant from, Instant to);
}
