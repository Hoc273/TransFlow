package com.app.modules.credit.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.credit.entity.*;
import com.app.modules.credit.repository.CreditAccountRepository;
import com.app.modules.credit.repository.CreditTransactionRepository;
import com.app.modules.credit.repository.WorkspaceBillingConfigRepository;
import com.app.modules.credit.service.CreditService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

@Service
public class CreditServiceImpl implements CreditService {

    private final CreditAccountRepository creditAccountRepository;
    private final CreditTransactionRepository creditTransactionRepository;
    private final WorkspaceBillingConfigRepository workspaceBillingConfigRepository;

    public CreditServiceImpl(CreditAccountRepository creditAccountRepository,
                             CreditTransactionRepository creditTransactionRepository,
                             WorkspaceBillingConfigRepository workspaceBillingConfigRepository) {
        this.creditAccountRepository = creditAccountRepository;
        this.creditTransactionRepository = creditTransactionRepository;
        this.workspaceBillingConfigRepository = workspaceBillingConfigRepository;
    }

    @Override
    @Transactional
    public CreditAccount grantInitialCredit(UUID userId, BigDecimal initialAmount) {
        return creditAccountRepository.findByUserId(userId).orElseGet(() -> {
            CreditAccount creditAccount = new CreditAccount();
            creditAccount.setUserId(userId);
            creditAccount.setBalance(initialAmount);
            CreditAccount saved = creditAccountRepository.save(creditAccount);

            CreditTransaction transaction = new CreditTransaction();
            transaction.setUserId(userId);
            transaction.setAmount(initialAmount);
            transaction.setBalanceAfter(initialAmount);
            transaction.setType(CreditTransactionType.INITIAL_GRANT);
            transaction.setPerformedByUserId(userId);
            transaction.setRefType("INITIAL_GRANT");
            creditTransactionRepository.save(transaction);

            return saved;
        });
    }

    @Override
    @Transactional
    public WorkspaceBillingConfig initWorkspaceBillingConfig(UUID workspaceId, UUID configuredByUserId, CostMode costMode) {
        WorkspaceBillingConfig billingConfig = new WorkspaceBillingConfig();
        billingConfig.setWorkspaceId(workspaceId);
        billingConfig.setCostMode(costMode != null ? costMode : CostMode.PAY_PER_USER);
        billingConfig.setConfiguredBy(configuredByUserId);
        return workspaceBillingConfigRepository.save(billingConfig);
    }

    @Override
    @Transactional(readOnly = true)
    public WorkspaceBillingConfig getWorkspaceBillingConfig(UUID workspaceId) {
        return workspaceBillingConfigRepository.findById(workspaceId)
                .orElseGet(() -> {
                    WorkspaceBillingConfig config = new WorkspaceBillingConfig();
                    config.setWorkspaceId(workspaceId);
                    config.setCostMode(CostMode.PAY_PER_USER);
                    return config;
                });
    }

    @Override
    @Transactional
    public WorkspaceBillingConfig updateCostMode(UUID workspaceId, UUID configuredByUserId, CostMode costMode) {
        WorkspaceBillingConfig config = workspaceBillingConfigRepository.findById(workspaceId)
                .orElseGet(() -> {
                    WorkspaceBillingConfig newConfig = new WorkspaceBillingConfig();
                    newConfig.setWorkspaceId(workspaceId);
                    return newConfig;
                });
        config.setCostMode(costMode != null ? costMode : CostMode.PAY_PER_USER);
        config.setConfiguredBy(configuredByUserId);
        return workspaceBillingConfigRepository.save(config);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<CreditAccount> findByUserId(UUID userId) {
        return creditAccountRepository.findByUserId(userId);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean hasSufficientBalance(UUID userId) {
        return creditAccountRepository.findByUserId(userId)
                .map(acc -> acc.getBalance().compareTo(BigDecimal.ZERO) > 0)
                .orElse(false);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean hasSufficientBalance(UUID userId, BigDecimal requiredAmount) {
        return creditAccountRepository.findByUserId(userId)
                .map(acc -> acc.getBalance().compareTo(requiredAmount) >= 0)
                .orElse(false);
    }

    @Override
    @Transactional
    public void chargeUsage(UUID workspaceId, UUID performedByUserId, String capability, long tokensUsed, boolean hasPersonalApiKey) {
        // Resolve cost mode of the workspace
        CostMode costMode = workspaceBillingConfigRepository.findById(workspaceId)
                .map(WorkspaceBillingConfig::getCostMode)
                .orElse(CostMode.PAY_PER_USER);

        UUID chargedUserId = (costMode == CostMode.PAY_PER_USER) ? performedByUserId : performedByUserId; // default fallback

        CreditAccount account = creditAccountRepository.findByUserId(chargedUserId)
                .orElseThrow(() -> new AppException(ErrorCode.INSUFFICIENT_CREDIT));

        // Stub calculation until pricing config is resolved; deduct tokens/units
        BigDecimal cost = BigDecimal.valueOf(tokensUsed).multiply(new BigDecimal("0.001"));
        if (account.getBalance().compareTo(cost) < 0) {
            throw new AppException(ErrorCode.INSUFFICIENT_CREDIT);
        }

        BigDecimal newBalance = account.getBalance().subtract(cost);
        account.setBalance(newBalance);
        creditAccountRepository.save(account);

        CreditTransaction tx = new CreditTransaction();
        tx.setUserId(chargedUserId);
        tx.setAmount(cost.negate());
        tx.setBalanceAfter(newBalance);
        tx.setType(CreditTransactionType.AI_USAGE);
        tx.setPerformedByUserId(performedByUserId);
        tx.setRefType(capability);
        creditTransactionRepository.save(tx);
    }
}
