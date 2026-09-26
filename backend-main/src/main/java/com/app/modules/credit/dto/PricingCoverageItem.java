package com.app.modules.credit.dto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * How a platform provider/model is priced right now (§10.3). {@code matchedBy}: EXACT
 * ({@code protocol/model} row), PROTOCOL ({@code protocol} row), DEFAULT (NULL row) or MISSING
 * (no row at all — billing falls back to the hard-coded coefficients).
 */
public record PricingCoverageItem(
        UUID providerId,
        String providerName,
        String capability,
        String pricingScope,
        MatchedBy matchedBy,
        UUID matchedVersionId,
        String matchedScope,
        BigDecimal infraCoefficientX,
        BigDecimal tokenCoefficientY
) {

    public enum MatchedBy { EXACT, PROTOCOL, DEFAULT, MISSING }
}
