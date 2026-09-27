package com.app.modules.credit.dto;

import com.app.modules.credit.entity.CreditPricingConfig;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** One version of a {@code credit_pricing_config} row (Credit_Coefficient_Calculation §10). */
public record PricingVersionResponse(
        UUID id,
        String capability,
        String providerScope,
        BigDecimal infraCoefficientX,
        BigDecimal tokenCoefficientY,
        Instant effectiveFrom,
        Instant effectiveTo,
        Status status,
        UUID createdByUserId,
        String changeReason,
        Instant createdAt
) {

    public enum Status { ACTIVE, SCHEDULED, EXPIRED }

    public static PricingVersionResponse from(CreditPricingConfig c, Instant now) {
        Status status;
        if (c.getEffectiveFrom().isAfter(now)) {
            status = Status.SCHEDULED;
        } else if (c.getEffectiveTo() == null || c.getEffectiveTo().isAfter(now)) {
            status = Status.ACTIVE;
        } else {
            status = Status.EXPIRED;
        }
        return new PricingVersionResponse(c.getId(), c.getCapability(), c.getProviderScope(),
                c.getInfraCoefficientX(), c.getTokenCoefficientY() != null ? c.getTokenCoefficientY() : BigDecimal.ZERO,
                c.getEffectiveFrom(), c.getEffectiveTo(), status, c.getCreatedByUserId(), c.getChangeReason(),
                c.getCreatedAt());
    }
}
