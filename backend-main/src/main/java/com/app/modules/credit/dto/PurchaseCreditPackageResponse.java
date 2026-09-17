package com.app.modules.credit.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record PurchaseCreditPackageResponse(
        UUID purchaseId,
        UUID packageId,
        BigDecimal creditAmount,
        BigDecimal pricePaid,
        String paymentReference,
        BigDecimal newBalance,
        Instant purchasedAt
) {
}
