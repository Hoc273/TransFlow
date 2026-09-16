package com.app.modules.credit.dto;

import com.app.modules.credit.entity.CreditTransaction;
import com.app.modules.credit.entity.CreditTransactionType;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record CreditTransactionResponse(
        UUID id,
        UUID userId,
        BigDecimal amount,
        BigDecimal balanceAfter,
        CreditTransactionType type,
        UUID performedByUserId,
        String refType,
        UUID refId,
        Instant createdAt
) {
    public static CreditTransactionResponse from(CreditTransaction tx) {
        return new CreditTransactionResponse(
                tx.getId(),
                tx.getUserId(),
                tx.getAmount(),
                tx.getBalanceAfter(),
                tx.getType(),
                tx.getPerformedByUserId(),
                tx.getRefType(),
                tx.getRefId(),
                tx.getCreatedAt()
        );
    }
}
