package com.app.modules.credit.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * One credit account as seen by the Super Admin credit monitor.
 *
 * @param ledgerBalance    sum of every {@code credit_transactions.amount} of the user; every balance
 *                         change writes a transaction of the same amount, so it must equal {@code balance}
 * @param creditedInWindow credit added since the window start, initial grant excluded
 * @param usedInWindow     credit charged for AI usage since the window start (positive number)
 * @param unverifiedCredit credit from purchases made before review existed ({@code LEGACY_UNVERIFIED})
 */
public record CreditAccountSnapshot(
        UUID userId,
        BigDecimal balance,
        BigDecimal ledgerBalance,
        BigDecimal creditedInWindow,
        BigDecimal usedInWindow,
        BigDecimal unverifiedCredit,
        Instant lastActivityAt
) {
    public boolean ledgerMismatch() {
        return balance.compareTo(ledgerBalance) != 0;
    }

    public boolean hasUnverifiedCredit() {
        return unverifiedCredit.signum() > 0;
    }
}
