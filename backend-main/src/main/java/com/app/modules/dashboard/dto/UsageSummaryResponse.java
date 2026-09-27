package com.app.modules.dashboard.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * Usage telemetry response for AI usage logs (API_Contract.md §10 line 239).
 */
public record UsageSummaryResponse(
        long totalInputTokens,
        long totalOutputTokens,
        long totalTokens,
        long totalOperations,
        BigDecimal totalCreditUsed,
        String groupBy,
        List<UsageGroupItemResponse> items
) {
    public record UsageGroupItemResponse(
            String groupKey,
            String groupLabel,
            long inputTokens,
            long outputTokens,
            long totalTokens,
            long operations,
            BigDecimal creditUsed
    ) {}
}
