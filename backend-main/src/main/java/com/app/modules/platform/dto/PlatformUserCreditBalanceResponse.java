package com.app.modules.platform.dto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Response for GET /api/platform/users/{userId}/credit/balance.
 */
public record PlatformUserCreditBalanceResponse(
        UUID userId,
        BigDecimal balance
) {
}
