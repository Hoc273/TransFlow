package com.app.modules.platform.dto;

import com.app.modules.credit.dto.CreditPurchaseResponse;
import com.app.modules.credit.entity.CreditPurchaseStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Row of GET /api/platform/credit/purchases — a purchase plus the buyer's identity. */
public record PlatformCreditPurchaseItem(
        UUID purchaseId,
        UUID userId,
        String userEmail,
        String userFullName,
        UUID packageId,
        String packageName,
        BigDecimal creditAmount,
        BigDecimal pricePaid,
        String priceCurrency,
        String paymentReference,
        CreditPurchaseStatus status,
        Instant purchasedAt,
        Instant reviewedAt,
        String reviewNote
) {
    public static PlatformCreditPurchaseItem of(CreditPurchaseResponse p, String userEmail, String userFullName) {
        return new PlatformCreditPurchaseItem(
                p.purchaseId(), p.userId(), userEmail, userFullName, p.packageId(), p.packageName(),
                p.creditAmount(), p.pricePaid(), p.priceCurrency(), p.paymentReference(), p.status(),
                p.purchasedAt(), p.reviewedAt(), p.reviewNote());
    }
}
