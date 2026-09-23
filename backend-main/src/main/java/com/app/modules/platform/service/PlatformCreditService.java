package com.app.modules.platform.service;

import com.app.modules.credit.dto.AdminCreditAdjustResponse;
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
}
