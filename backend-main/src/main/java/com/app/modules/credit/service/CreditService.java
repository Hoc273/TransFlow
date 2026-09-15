package com.app.modules.credit.service;

import com.app.modules.credit.entity.*;
import com.app.modules.credit.repository.CreditAccountRepository;
import com.app.modules.credit.repository.CreditTransactionRepository;
import com.app.modules.credit.repository.WorkspaceBillingConfigRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

@Service
public class CreditService {

    private final CreditAccountRepository creditAccountRepository;
    private final CreditTransactionRepository creditTransactionRepository;
    private final WorkspaceBillingConfigRepository workspaceBillingConfigRepository;

    public CreditService(CreditAccountRepository creditAccountRepository,
                         CreditTransactionRepository creditTransactionRepository,
                         WorkspaceBillingConfigRepository workspaceBillingConfigRepository) {
        this.creditAccountRepository = creditAccountRepository;
        this.creditTransactionRepository = creditTransactionRepository;
        this.workspaceBillingConfigRepository = workspaceBillingConfigRepository;
    }

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

    @Transactional
    public WorkspaceBillingConfig initWorkspaceBillingConfig(UUID workspaceId, UUID configuredByUserId, CostMode costMode) {
        WorkspaceBillingConfig billingConfig = new WorkspaceBillingConfig();
        billingConfig.setWorkspaceId(workspaceId);
        billingConfig.setCostMode(costMode != null ? costMode : CostMode.PAY_PER_USER);
        billingConfig.setConfiguredBy(configuredByUserId);
        return workspaceBillingConfigRepository.save(billingConfig);
    }

    @Transactional(readOnly = true)
    public Optional<CreditAccount> findByUserId(UUID userId) {
        return creditAccountRepository.findByUserId(userId);
    }

    @Transactional(readOnly = true)
    public boolean hasSufficientBalance(UUID userId, BigDecimal requiredAmount) {
        return creditAccountRepository.findByUserId(userId)
                .map(acc -> acc.getBalance().compareTo(requiredAmount) >= 0)
                .orElse(false);
    }
}
