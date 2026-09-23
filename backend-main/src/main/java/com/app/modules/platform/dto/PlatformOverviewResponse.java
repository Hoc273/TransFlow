package com.app.modules.platform.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * {@code GET /api/platform/overview} — KPI groups (API_Contract.md §13.1).
 * Mini scope has exactly two real job types: {@code mediaJobs} (media_jobs)
 * and {@code batchJobs} (localization_batches). {@code textJobs} and
 * {@code productionJobs} are kept as {@link UnavailableJobType} markers
 * ({@code {"available": false}}) — the domains do not exist (SRS §4.3) but
 * the FE contract still expects the keys.
 */
public record PlatformOverviewResponse(
        Instant from,
        Instant to,
        CountInRange users,
        CountInRange workspaces,
        JobsBlock jobs,
        TokensBlock tokens,
        FailRateBlock failRate,
        List<TopWorkspaceItem> topWorkspaces
) {
    public record CountInRange(long total, long newInRange) {}

    public record JobsBlock(
            JobStatusCounts mediaJobs,
            JobStatusCounts batchJobs,
            UnavailableJobType textJobs,
            UnavailableJobType productionJobs
    ) {}

    public record TokensBlock(
            long inputTokens,
            long outputTokens,
            long totalTokens,
            Map<String, OperationTokens> byOperation
    ) {}

    public record OperationTokens(long inputTokens, long outputTokens) {}

    /** {@code rate} is null when no terminal jobs exist in range. */
    public record FailRateBlock(Double rate, long failedCount, long terminalCount) {}

    public record TopWorkspaceItem(
            UUID workspaceId,
            String workspaceName,
            long totalTokens,
            long jobCount
    ) {}
}
