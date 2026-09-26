package com.app.modules.credit.service;

import com.app.common.dto.PageResponse;
import com.app.modules.credit.dto.*;
import com.app.modules.credit.entity.CostMode;
import com.app.modules.credit.entity.CreditAccount;
import com.app.modules.credit.entity.CreditTransactionType;
import com.app.modules.credit.entity.WorkspaceBillingConfig;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Credit service interface (API_Contract.md §10, CLAUDE_A.md §8.4 & TaskSplit §4).
 */
public interface CreditService {

    CreditAccount grantInitialCredit(UUID userId, BigDecimal initialAmount);

    WorkspaceBillingConfig initWorkspaceBillingConfig(UUID workspaceId, UUID configuredByUserId, CostMode costMode);

    WorkspaceBillingConfig getWorkspaceBillingConfig(UUID workspaceId);

    WorkspaceBillingConfig updateCostMode(UUID workspaceId, UUID configuredByUserId, CostMode costMode);

    Optional<CreditAccount> findByUserId(UUID userId);

    BigDecimal getBalance(UUID userId);

    boolean hasSufficientBalance(UUID userId);

    boolean hasSufficientBalance(UUID userId, BigDecimal requiredAmount);

    /** Positive balance of whoever pays in this workspace (the Lead under LEAD_PAYS_ALL). */
    boolean hasSufficientBalance(UUID workspaceId, UUID performedByUserId);

    /**
     * Pre-flight check before an AI call: can the workspace payer cover {@code estimatedUnits}
     * of {@code capability}? The real charge still happens afterwards with the measured usage.
     */
    boolean canAffordUsage(UUID workspaceId, UUID performedByUserId, String capability,
                           long estimatedUnits, boolean hasPersonalApiKey);

    BigDecimal chargeUsage(UUID workspaceId, UUID performedByUserId, String capability, long tokensUsed, boolean hasPersonalApiKey);

    PageResponse<CreditTransactionResponse> getTransactions(UUID userId, CreditTransactionType type, Instant from, Instant to, int page, int size);

    List<CreditPackageResponse> listActivePackages();

    PurchaseCreditPackageResponse purchasePackage(UUID userId, UUID packageId, PurchaseCreditPackageRequest req);

    /**
     * Admin credit adjustment (grant or deduct) for any user.
     * amount positive = grant, negative = deduct.
     */
    AdminCreditAdjustResponse adminAdjustCredit(UUID adminId, UUID targetUserId, BigDecimal amount, String reason);
}
