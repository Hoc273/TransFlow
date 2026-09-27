package com.app.modules.credit.dto;

import com.app.modules.credit.entity.CreditPackage;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record CreditPackageResponse(
        UUID id,
        String name,
        BigDecimal creditAmount,
        BigDecimal priceAmount,
        String priceCurrency,
        boolean isActive,
        Instant createdAt
) {
    public static CreditPackageResponse from(CreditPackage pkg) {
        return new CreditPackageResponse(
                pkg.getId(),
                pkg.getName(),
                pkg.getCreditAmount(),
                pkg.getPriceAmount(),
                pkg.getPriceCurrency(),
                pkg.isActive(),
                pkg.getCreatedAt()
        );
    }
}
