package com.app.modules.credit.dto;

import com.app.modules.credit.entity.CreditPackagePurchase;
import com.app.modules.credit.entity.CreditPurchaseStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A credit package purchase request (API_Contract.md §10). Credit is added to the balance only
 * once {@code status} becomes {@code APPROVED}.
 */
public record CreditPurchaseResponse(
        UUID purchaseId,
        UUID userId,
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
    public static CreditPurchaseResponse from(CreditPackagePurchase p, String packageName, String priceCurrency) {
        return new CreditPurchaseResponse(
                p.getId(), p.getUserId(), p.getPackageId(), packageName,
                p.getCreditAmount(), p.getPricePaid(), priceCurrency, p.getPaymentReference(),
                p.getStatus(), p.getPurchasedAt(), p.getReviewedAt(), p.getReviewNote());
    }
}
