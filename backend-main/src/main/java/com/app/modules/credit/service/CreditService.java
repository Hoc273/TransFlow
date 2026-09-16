package com.app.modules.credit.service;

import com.app.modules.credit.entity.CostMode;
import com.app.modules.credit.entity.CreditAccount;
import com.app.modules.credit.entity.WorkspaceBillingConfig;

import java.math.BigDecimal;
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

    boolean hasSufficientBalance(UUID userId);

    boolean hasSufficientBalance(UUID userId, BigDecimal requiredAmount);

    void chargeUsage(UUID workspaceId, UUID performedByUserId, String capability, long tokensUsed, boolean hasPersonalApiKey);
}
