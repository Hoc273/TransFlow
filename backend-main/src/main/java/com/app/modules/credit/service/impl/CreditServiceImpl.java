package com.app.modules.credit.service.impl;

import com.app.common.dto.PageResponse;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.credit.dto.*;
import com.app.modules.credit.entity.*;
import com.app.modules.credit.repository.*;
import com.app.modules.credit.service.CreditService;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class CreditServiceImpl implements CreditService {

    private static final Logger log = LoggerFactory.getLogger(CreditServiceImpl.class);

    private static final BigDecimal DEFAULT_INFRA_X = new BigDecimal("0.000100");
    private static final BigDecimal DEFAULT_TOKEN_Y = new BigDecimal("0.000500");

    private final CreditAccountRepository creditAccountRepository;
    private final CreditTransactionRepository creditTransactionRepository;
    private final WorkspaceBillingConfigRepository workspaceBillingConfigRepository;
    private final CreditPricingConfigRepository creditPricingConfigRepository;
    private final CreditPackageRepository creditPackageRepository;
    private final CreditPackagePurchaseRepository creditPackagePurchaseRepository;
    private final WorkspaceAccessService workspaceAccessService;

    public CreditServiceImpl(CreditAccountRepository creditAccountRepository,
                             CreditTransactionRepository creditTransactionRepository,
                             WorkspaceBillingConfigRepository workspaceBillingConfigRepository,
                             CreditPricingConfigRepository creditPricingConfigRepository,
                             CreditPackageRepository creditPackageRepository,
                             CreditPackagePurchaseRepository creditPackagePurchaseRepository,
                             WorkspaceAccessService workspaceAccessService) {
        this.creditAccountRepository = creditAccountRepository;
        this.creditTransactionRepository = creditTransactionRepository;
        this.workspaceBillingConfigRepository = workspaceBillingConfigRepository;
        this.creditPricingConfigRepository = creditPricingConfigRepository;
        this.creditPackageRepository = creditPackageRepository;
        this.creditPackagePurchaseRepository = creditPackagePurchaseRepository;
        this.workspaceAccessService = workspaceAccessService;
    }

    @Override
    @Transactional
    public CreditAccount grantInitialCredit(UUID userId, BigDecimal initialAmount) {
        return creditAccountRepository.findByUserId(userId).orElseGet(() -> {
            CreditAccount creditAccount = new CreditAccount();
            creditAccount.setUserId(userId);
            creditAccount.setBalance(initialAmount != null ? initialAmount : BigDecimal.ZERO);
            CreditAccount saved = creditAccountRepository.save(creditAccount);

            CreditTransaction transaction = new CreditTransaction();
            transaction.setUserId(userId);
            transaction.setAmount(creditAccount.getBalance());
            transaction.setBalanceAfter(creditAccount.getBalance());
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
    public BigDecimal getBalance(UUID userId) {
        return creditAccountRepository.findByUserId(userId)
                .map(CreditAccount::getBalance)
                .orElse(BigDecimal.ZERO);
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
        BigDecimal target = (requiredAmount != null && requiredAmount.compareTo(BigDecimal.ZERO) > 0)
                ? requiredAmount
                : BigDecimal.ZERO;
        return creditAccountRepository.findByUserId(userId)
                .map(acc -> acc.getBalance().compareTo(target) >= 0)
                .orElse(false);
    }

    @Override
    @Transactional
    public BigDecimal chargeUsage(UUID workspaceId, UUID performedByUserId, String capability, long tokensUsed, boolean hasPersonalApiKey) {
        // 1. Resolve Workspace Cost Mode (SRS §5.6, Arch §10.3)
        CostMode costMode = workspaceBillingConfigRepository.findById(workspaceId)
                .map(WorkspaceBillingConfig::getCostMode)
                .orElse(CostMode.PAY_PER_USER);

        UUID chargedUserId;
        if (costMode == CostMode.LEAD_PAYS_ALL) {
            chargedUserId = workspaceAccessService.findLeadUserId(workspaceId)
                    .orElse(performedByUserId);
        } else {
            chargedUserId = performedByUserId;
        }

        // 2. Resolve Pricing Coefficients x and y (SRS §5.6, Arch §10.2)
        BigDecimal infraX = DEFAULT_INFRA_X;
        BigDecimal tokenY = DEFAULT_TOKEN_Y;
        List<CreditPricingConfig> pricingConfigs = creditPricingConfigRepository.findActivePricing(capability, null);
        if (!pricingConfigs.isEmpty()) {
            CreditPricingConfig config = pricingConfigs.get(0);
            if (config.getInfraCoefficientX() != null) {
                infraX = config.getInfraCoefficientX();
            }
            if (config.getTokenCoefficientY() != null) {
                tokenY = config.getTokenCoefficientY();
            }
        } else {
            log.warn("No active CreditPricingConfig found for capability={}, using fallback x={}, y={}", capability, infraX, tokenY);
        }

        // 3. Compute cost according to Case 1 or Case 2
        BigDecimal tokens = BigDecimal.valueOf(Math.max(0, tokensUsed));
        BigDecimal cost;
        if (hasPersonalApiKey) {
            // Trường hợp 1: có API key cá nhân -> x * tokens
            cost = infraX.multiply(tokens);
        } else {
            // Trường hợp 2: không có API key cá nhân (dùng nguồn nền tảng) -> (x + y) * tokens
            cost = infraX.add(tokenY).multiply(tokens);
        }
        cost = cost.setScale(4, RoundingMode.HALF_UP);

        // 4. Invariant khoá ghi (Arch §12): SELECT ... FOR UPDATE trên credit_accounts
        CreditAccount account = creditAccountRepository.findByUserIdForUpdate(chargedUserId)
                .orElseThrow(() -> new AppException(ErrorCode.INSUFFICIENT_CREDIT));

        if (account.getBalance().compareTo(cost) < 0) {
            throw new AppException(ErrorCode.INSUFFICIENT_CREDIT);
        }

        BigDecimal newBalance = account.getBalance().subtract(cost);
        account.setBalance(newBalance);
        creditAccountRepository.save(account);

        // 5. Append-only transaction log
        CreditTransaction tx = new CreditTransaction();
        tx.setUserId(chargedUserId);
        tx.setAmount(cost.negate());
        tx.setBalanceAfter(newBalance);
        tx.setType(CreditTransactionType.AI_USAGE);
        tx.setPerformedByUserId(performedByUserId);
        tx.setRefType(capability);
        creditTransactionRepository.save(tx);

        return cost;
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponse<CreditTransactionResponse> getTransactions(UUID userId, CreditTransactionType type,
                                                                  Instant from, Instant to, int page, int size) {
        int validatedPage = Math.max(0, page);
        int validatedSize = Math.max(1, Math.min(size, 100)); // Default 20, max 100 per API_Contract §0
        Pageable pageable = PageRequest.of(validatedPage, validatedSize);

        Page<CreditTransaction> txPage = creditTransactionRepository.findUserTransactions(userId, type, from, to, pageable);
        List<CreditTransactionResponse> items = txPage.getContent().stream()
                .map(CreditTransactionResponse::from)
                .toList();

        return new PageResponse<>(
                items,
                txPage.getNumber(),
                txPage.getSize(),
                txPage.getTotalElements(),
                txPage.getTotalPages()
        );
    }

    @Override
    @Transactional(readOnly = true)
    public List<CreditPackageResponse> listActivePackages() {
        return creditPackageRepository.findByIsActiveTrueOrderByCreditAmountAsc().stream()
                .map(CreditPackageResponse::from)
                .toList();
    }

    @Override
    @Transactional
    public PurchaseCreditPackageResponse purchasePackage(UUID userId, UUID packageId, PurchaseCreditPackageRequest req) {
        CreditPackage pkg = creditPackageRepository.findById(packageId)
                .orElseThrow(() -> new AppException(ErrorCode.CREDIT_PACKAGE_NOT_FOUND));

        if (!pkg.isActive()) {
            throw new AppException(ErrorCode.CREDIT_PACKAGE_INACTIVE);
        }

        // Lock user's credit account
        CreditAccount account = creditAccountRepository.findByUserIdForUpdate(userId)
                .orElseGet(() -> {
                    CreditAccount newAcc = new CreditAccount();
                    newAcc.setUserId(userId);
                    newAcc.setBalance(BigDecimal.ZERO);
                    return creditAccountRepository.save(newAcc);
                });

        BigDecimal newBalance = account.getBalance().add(pkg.getCreditAmount());
        account.setBalance(newBalance);
        creditAccountRepository.save(account);

        // Record purchase
        CreditPackagePurchase purchase = new CreditPackagePurchase();
        purchase.setUserId(userId);
        purchase.setPackageId(pkg.getId());
        purchase.setCreditAmount(pkg.getCreditAmount());
        purchase.setPricePaid(pkg.getPriceAmount());
        purchase.setPaymentReference(req.paymentReference().trim());
        purchase.setPurchasedAt(Instant.now());
        CreditPackagePurchase savedPurchase = creditPackagePurchaseRepository.save(purchase);

        // Record credit transaction
        CreditTransaction tx = new CreditTransaction();
        tx.setUserId(userId);
        tx.setAmount(pkg.getCreditAmount());
        tx.setBalanceAfter(newBalance);
        tx.setType(CreditTransactionType.PACKAGE_PURCHASE);
        tx.setPerformedByUserId(userId);
        tx.setRefType("PACKAGE_PURCHASE");
        tx.setRefId(savedPurchase.getId());
        creditTransactionRepository.save(tx);

        log.info("User {} purchased package '{}' ({} credits) with paymentReference={}",
                userId, pkg.getName(), pkg.getCreditAmount(), req.paymentReference());

        return new PurchaseCreditPackageResponse(
                savedPurchase.getId(),
                pkg.getId(),
                pkg.getCreditAmount(),
                pkg.getPriceAmount(),
                savedPurchase.getPaymentReference(),
                newBalance,
                savedPurchase.getPurchasedAt()
        );
    }
}
