package com.app.modules.platform.dto;

import java.math.BigDecimal;

/** GET /api/platform/credit/accounts — platform totals plus one page of accounts. */
public record PlatformCreditMonitorResponse(
        long accountCount,
        long flaggedCount,
        BigDecimal totalBalance,
        BigDecimal credited7d,
        BigDecimal used7d,
        PlatformPageResponse<PlatformCreditAccountItem> accounts
) {
}
