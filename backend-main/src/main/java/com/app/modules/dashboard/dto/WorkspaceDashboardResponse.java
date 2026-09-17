package com.app.modules.dashboard.dto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Quick overview dashboard response (API_Contract.md §13).
 */
public record WorkspaceDashboardResponse(
        JobStatusSummary jobs,
        BatchStatusSummary batches,
        CreditSummary credit
) {
    public record JobStatusSummary(
            long total,
            long pending,
            long processing,
            long completed,
            long failed,
            long cancelled
    ) {}

    public record BatchStatusSummary(
            long total,
            long running,
            long completed,
            long failed,
            long partiallyFailed,
            long cancelled
    ) {}

    public record CreditSummary(
            BigDecimal balance,
            String costMode,
            UUID chargedUserId
    ) {}
}
