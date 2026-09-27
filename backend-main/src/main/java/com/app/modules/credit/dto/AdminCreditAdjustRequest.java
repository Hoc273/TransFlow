package com.app.modules.credit.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * Request body for POST /api/platform/users/{userId}/credit/adjust.
 * amount positive = grant, negative = deduct.
 */
public record AdminCreditAdjustRequest(
        @NotNull(message = "amount must not be null")
        BigDecimal amount,

        @Size(max = 255)
        String reason
) {
}
