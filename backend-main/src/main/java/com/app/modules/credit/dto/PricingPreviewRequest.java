package com.app.modules.credit.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/** Body of POST /api/platform/pricing/preview — nothing is stored. */
public record PricingPreviewRequest(
        @NotBlank @Size(max = 50)
        String capability,

        @Size(max = 100)
        String providerScope,

        @NotNull @DecimalMin("0") @Digits(integer = 4, fraction = 6)
        BigDecimal infraCoefficientX,

        @NotNull @DecimalMin("0") @Digits(integer = 4, fraction = 6)
        BigDecimal tokenCoefficientY
) {
}
