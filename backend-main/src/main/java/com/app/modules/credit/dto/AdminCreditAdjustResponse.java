package com.app.modules.credit.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Response for POST /api/platform/users/{userId}/credit/adjust.
 */
public record AdminCreditAdjustResponse(
        UUID userId,
        BigDecimal amount,
        BigDecimal balanceBefore,
        BigDecimal balanceAfter,
        String reason,
        Instant adjustedAt
) {
}
