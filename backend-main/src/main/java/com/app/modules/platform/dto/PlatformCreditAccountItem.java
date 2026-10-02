package com.app.modules.platform.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Row of GET /api/platform/credit/accounts. {@code flags} lists the anomalies found. */
public record PlatformCreditAccountItem(
        UUID userId,
        String email,
        String fullName,
        BigDecimal balance,
        BigDecimal ledgerBalance,
        BigDecimal credited7d,
        BigDecimal used7d,
        BigDecimal unverifiedCredit,
        Instant lastActivityAt,
        List<String> flags
) {
    /** Balance differs from the sum of the user's transactions: edited outside the ledger or a bug. */
    public static final String FLAG_LEDGER_MISMATCH = "LEDGER_MISMATCH";
    /** Holds credit from purchases made before Super Admin review existed. */
    public static final String FLAG_UNVERIFIED_CREDIT = "UNVERIFIED_CREDIT";
}
