package com.app.modules.credit.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Body of POST /api/platform/pricing — a new price version for one capability + provider_scope.
 * {@code effectiveFrom} null = now; it may be in the future but never in the past (no back-dating).
 */
public record CreatePricingVersionRequest(
        @NotBlank @Size(max = 50)
        String capability,

        @Size(max = 100)
        String providerScope,

        @NotNull @DecimalMin("0") @Digits(integer = 4, fraction = 6)
        BigDecimal infraCoefficientX,

        @NotNull @DecimalMin("0") @Digits(integer = 4, fraction = 6)
        BigDecimal tokenCoefficientY,

        Instant effectiveFrom,

        @NotBlank @Size(max = 500)
        String changeReason,

        /** Required when x or y moves more than ±50% from the current version. */
        Boolean confirmLargeChange
) {
}
