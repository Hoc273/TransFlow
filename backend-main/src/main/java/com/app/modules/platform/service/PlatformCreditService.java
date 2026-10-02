package com.app.modules.platform.service;

import com.app.modules.credit.dto.AdminCreditAdjustResponse;
import com.app.modules.credit.entity.CreditPurchaseStatus;
import com.app.modules.platform.dto.PlatformCreditMonitorResponse;
import com.app.modules.platform.dto.PlatformCreditPurchaseItem;
import com.app.modules.platform.dto.PlatformPageResponse;
import com.app.modules.platform.dto.PlatformUserCreditBalanceResponse;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Super Admin credit management for any user.
 * Every method enforces {@link PlatformAdminAccessService#requirePlatformAdmin}.
 */
public interface PlatformCreditService {

    PlatformUserCreditBalanceResponse getUserBalance(UUID callerId, UUID targetUserId);

    /** amount positive = grant, negative = deduct. */
    AdminCreditAdjustResponse adjustUserCredit(UUID callerId, UUID targetUserId, BigDecimal amount, String reason);

    enum MonitorSort { BALANCE, CREDITED_7D, USED_7D }

    /**
     * Credit monitor: every account with balance, 7-day inflow/usage and anomaly flags, sorted
     * descending by {@code sort}. {@code q} matches email or name.
     */
    PlatformCreditMonitorResponse creditMonitor(UUID callerId, String q, boolean flaggedOnly, MonitorSort sort,
                                                int page, int size);

    /** status null = every status. */
    PlatformPageResponse<PlatformCreditPurchaseItem> listPurchases(UUID callerId, CreditPurchaseStatus status,
                                                                   int page, int size);

    PlatformCreditPurchaseItem approvePurchase(UUID callerId, UUID purchaseId, String note);

    PlatformCreditPurchaseItem rejectPurchase(UUID callerId, UUID purchaseId, String note);
}
