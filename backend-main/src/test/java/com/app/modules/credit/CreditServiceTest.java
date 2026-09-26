package com.app.modules.credit;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.credit.dto.PurchaseCreditPackageRequest;
import com.app.modules.credit.dto.PurchaseCreditPackageResponse;
import com.app.modules.credit.entity.*;
import com.app.modules.credit.repository.*;
import com.app.modules.credit.service.impl.CreditServiceImpl;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CreditServiceTest {

    @Mock
    private CreditAccountRepository creditAccountRepository;
    @Mock
    private CreditTransactionRepository creditTransactionRepository;
    @Mock
    private WorkspaceBillingConfigRepository workspaceBillingConfigRepository;
    @Mock
    private CreditPricingConfigRepository creditPricingConfigRepository;
    @Mock
    private CreditPackageRepository creditPackageRepository;
    @Mock
    private CreditPackagePurchaseRepository creditPackagePurchaseRepository;
    @Mock
    private WorkspaceAccessService workspaceAccessService;

    private CreditServiceImpl creditService;

    private final UUID userId = UUID.randomUUID();
    private final UUID workspaceId = UUID.randomUUID();
    private final UUID leadId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        creditService = new CreditServiceImpl(
                creditAccountRepository,
                creditTransactionRepository,
                workspaceBillingConfigRepository,
                creditPricingConfigRepository,
                creditPackageRepository,
                creditPackagePurchaseRepository,
                workspaceAccessService
        );
    }

    @Test
    void testHasSufficientBalance_WhenPositive_ReturnsTrue() {
        CreditAccount account = new CreditAccount();
        account.setBalance(new BigDecimal("10.0000"));
        when(creditAccountRepository.findByUserId(userId)).thenReturn(Optional.of(account));

        assertTrue(creditService.hasSufficientBalance(userId));
    }

    @Test
    void testHasSufficientBalance_WhenZero_ReturnsFalse() {
        CreditAccount account = new CreditAccount();
        account.setBalance(BigDecimal.ZERO);
        when(creditAccountRepository.findByUserId(userId)).thenReturn(Optional.of(account));

        assertFalse(creditService.hasSufficientBalance(userId));
    }

    @Test
    void testHasSufficientBalance_WhenNotFound_ReturnsFalse() {
        when(creditAccountRepository.findByUserId(userId)).thenReturn(Optional.empty());

        assertFalse(creditService.hasSufficientBalance(userId));
    }

    private CreditAccount account(String balance) {
        CreditAccount account = new CreditAccount();
        account.setBalance(new BigDecimal(balance));
        return account;
    }

    private void leadPaysAll() {
        WorkspaceBillingConfig config = new WorkspaceBillingConfig();
        config.setCostMode(CostMode.LEAD_PAYS_ALL);
        when(workspaceBillingConfigRepository.findById(workspaceId)).thenReturn(Optional.of(config));
        when(workspaceAccessService.findLeadUserId(workspaceId)).thenReturn(Optional.of(leadId));
    }

    @Test
    void workspaceBalanceCheckUsesTheLeadUnderLeadPaysAll() {
        leadPaysAll();
        when(creditAccountRepository.findByUserId(leadId)).thenReturn(Optional.of(account("5.0000")));

        assertTrue(creditService.hasSufficientBalance(workspaceId, userId));
        verify(creditAccountRepository, never()).findByUserId(userId);
    }

    @Test
    void canAffordUsageComparesTheEstimatedCostWithThePayerBalance() {
        when(workspaceBillingConfigRepository.findById(workspaceId)).thenReturn(Optional.empty());
        when(creditPricingConfigRepository.findActivePricing("TTS", null)).thenReturn(List.of());
        when(creditAccountRepository.findByUserId(userId)).thenReturn(Optional.of(account("0.5000")));

        // Platform source: (0.0001 + 0.0005) * 500 = 0.3 <= 0.5; * 1000 = 0.6 > 0.5
        assertTrue(creditService.canAffordUsage(workspaceId, userId, "TTS", 500, false));
        assertFalse(creditService.canAffordUsage(workspaceId, userId, "TTS", 1000, false));
        // Personal key: 0.0001 * 1000 = 0.1
        assertTrue(creditService.canAffordUsage(workspaceId, userId, "TTS", 1000, true));
    }

    @Test
    void canAffordUsageRejectsAnEmptyBalanceEvenForAFreeEstimate() {
        when(workspaceBillingConfigRepository.findById(workspaceId)).thenReturn(Optional.empty());
        when(creditPricingConfigRepository.findActivePricing("STT", null)).thenReturn(List.of());
        when(creditAccountRepository.findByUserId(userId)).thenReturn(Optional.of(account("0.0000")));

        assertFalse(creditService.canAffordUsage(workspaceId, userId, "STT", 0, true));
    }

    @Test
    void testChargeUsage_WithPersonalApiKey_Case1_PayPerUser() {
        // Workspace cost mode = PAY_PER_USER
        WorkspaceBillingConfig config = new WorkspaceBillingConfig();
        config.setCostMode(CostMode.PAY_PER_USER);
        when(workspaceBillingConfigRepository.findById(workspaceId)).thenReturn(Optional.of(config));

        // Pricing: x = 0.000100, y = 0.000300
        CreditPricingConfig pricing = new CreditPricingConfig();
        pricing.setInfraCoefficientX(new BigDecimal("0.000100"));
        pricing.setTokenCoefficientY(new BigDecimal("0.000300"));
        when(creditPricingConfigRepository.findActivePricing("TRANSLATE", null)).thenReturn(List.of(pricing));

        // Account with balance 50.0000
        CreditAccount account = new CreditAccount();
        account.setUserId(userId);
        account.setBalance(new BigDecimal("50.0000"));
        when(creditAccountRepository.findByUserIdForUpdate(userId)).thenReturn(Optional.of(account));

        // tokensUsed = 10000 -> Case 1: x * tokens = 0.000100 * 10000 = 1.0000
        BigDecimal charged = creditService.chargeUsage(workspaceId, userId, "TRANSLATE", 10000, true);

        assertEquals(new BigDecimal("1.0000"), charged);
        assertEquals(new BigDecimal("49.0000"), account.getBalance());
        verify(creditAccountRepository).save(account);

        ArgumentCaptor<CreditTransaction> txCaptor = ArgumentCaptor.forClass(CreditTransaction.class);
        verify(creditTransactionRepository).save(txCaptor.capture());
        CreditTransaction tx = txCaptor.getValue();
        assertEquals(userId, tx.getUserId());
        assertEquals(userId, tx.getPerformedByUserId());
        assertEquals(new BigDecimal("-1.0000"), tx.getAmount());
        assertEquals(new BigDecimal("49.0000"), tx.getBalanceAfter());
        assertEquals(CreditTransactionType.AI_USAGE, tx.getType());
        assertEquals("TRANSLATE", tx.getRefType());
    }

    @Test
    void testChargeUsage_WithoutPersonalApiKey_Case2_PayPerUser() {
        WorkspaceBillingConfig config = new WorkspaceBillingConfig();
        config.setCostMode(CostMode.PAY_PER_USER);
        when(workspaceBillingConfigRepository.findById(workspaceId)).thenReturn(Optional.of(config));

        CreditPricingConfig pricing = new CreditPricingConfig();
        pricing.setInfraCoefficientX(new BigDecimal("0.000100"));
        pricing.setTokenCoefficientY(new BigDecimal("0.000300"));
        when(creditPricingConfigRepository.findActivePricing("TRANSLATE", null)).thenReturn(List.of(pricing));

        CreditAccount account = new CreditAccount();
        account.setUserId(userId);
        account.setBalance(new BigDecimal("50.0000"));
        when(creditAccountRepository.findByUserIdForUpdate(userId)).thenReturn(Optional.of(account));

        // tokensUsed = 10000 -> Case 2: (x + y) * tokens = (0.000100 + 0.000300) * 10000 = 4.0000
        BigDecimal charged = creditService.chargeUsage(workspaceId, userId, "TRANSLATE", 10000, false);

        assertEquals(new BigDecimal("4.0000"), charged);
        assertEquals(new BigDecimal("46.0000"), account.getBalance());
        verify(creditAccountRepository).save(account);
    }

    @Test
    void testChargeUsage_LeadPaysAll_ChargesWorkspaceLead() {
        WorkspaceBillingConfig config = new WorkspaceBillingConfig();
        config.setCostMode(CostMode.LEAD_PAYS_ALL);
        when(workspaceBillingConfigRepository.findById(workspaceId)).thenReturn(Optional.of(config));
        when(workspaceAccessService.findLeadUserId(workspaceId)).thenReturn(Optional.of(leadId));

        CreditPricingConfig pricing = new CreditPricingConfig();
        pricing.setInfraCoefficientX(new BigDecimal("0.000100"));
        pricing.setTokenCoefficientY(new BigDecimal("0.000300"));
        when(creditPricingConfigRepository.findActivePricing("TTS", null)).thenReturn(List.of(pricing));

        CreditAccount leadAccount = new CreditAccount();
        leadAccount.setUserId(leadId);
        leadAccount.setBalance(new BigDecimal("100.0000"));
        when(creditAccountRepository.findByUserIdForUpdate(leadId)).thenReturn(Optional.of(leadAccount));

        // Performed by member (userId), has personal API key -> cost = 0.000100 * 5000 = 0.5000
        BigDecimal charged = creditService.chargeUsage(workspaceId, userId, "TTS", 5000, true);

        assertEquals(new BigDecimal("0.5000"), charged);
        assertEquals(new BigDecimal("99.5000"), leadAccount.getBalance());

        ArgumentCaptor<CreditTransaction> txCaptor = ArgumentCaptor.forClass(CreditTransaction.class);
        verify(creditTransactionRepository).save(txCaptor.capture());
        CreditTransaction tx = txCaptor.getValue();
        assertEquals(leadId, tx.getUserId()); // charged user is Lead
        assertEquals(userId, tx.getPerformedByUserId()); // performed by member
    }

    @Test
    void testChargeUsage_InsufficientCredit_ThrowsAppException() {
        WorkspaceBillingConfig config = new WorkspaceBillingConfig();
        config.setCostMode(CostMode.PAY_PER_USER);
        when(workspaceBillingConfigRepository.findById(workspaceId)).thenReturn(Optional.of(config));

        CreditPricingConfig pricing = new CreditPricingConfig();
        pricing.setInfraCoefficientX(new BigDecimal("0.000100"));
        pricing.setTokenCoefficientY(new BigDecimal("0.000300"));
        when(creditPricingConfigRepository.findActivePricing("TRANSLATE", null)).thenReturn(List.of(pricing));

        CreditAccount account = new CreditAccount();
        account.setUserId(userId);
        account.setBalance(new BigDecimal("0.5000"));
        when(creditAccountRepository.findByUserIdForUpdate(userId)).thenReturn(Optional.of(account));

        // cost = 4.0000 > balance 0.5000
        AppException ex = assertThrows(AppException.class, () ->
                creditService.chargeUsage(workspaceId, userId, "TRANSLATE", 10000, false)
        );

        assertEquals(ErrorCode.INSUFFICIENT_CREDIT, ex.getErrorCode());
        assertEquals(new BigDecimal("0.5000"), account.getBalance()); // balance untouched
        verify(creditTransactionRepository, never()).save(any());
    }

    @Test
    void testPurchasePackage_Success() {
        UUID packageId = UUID.randomUUID();
        CreditPackage pkg = new CreditPackage();
        pkg.setId(packageId);
        pkg.setName("Starter");
        pkg.setCreditAmount(new BigDecimal("500.0000"));
        pkg.setPriceAmount(new BigDecimal("50000.00"));
        pkg.setActive(true);
        when(creditPackageRepository.findById(packageId)).thenReturn(Optional.of(pkg));

        CreditAccount account = new CreditAccount();
        account.setUserId(userId);
        account.setBalance(new BigDecimal("10.0000"));
        when(creditAccountRepository.findByUserIdForUpdate(userId)).thenReturn(Optional.of(account));

        CreditPackagePurchase savedPurchase = new CreditPackagePurchase();
        savedPurchase.setId(UUID.randomUUID());
        savedPurchase.setUserId(userId);
        savedPurchase.setPackageId(packageId);
        savedPurchase.setCreditAmount(pkg.getCreditAmount());
        savedPurchase.setPricePaid(pkg.getPriceAmount());
        savedPurchase.setPaymentReference("PAY-12345");
        when(creditPackagePurchaseRepository.save(any(CreditPackagePurchase.class))).thenReturn(savedPurchase);

        PurchaseCreditPackageRequest req = new PurchaseCreditPackageRequest("PAY-12345");
        PurchaseCreditPackageResponse res = creditService.purchasePackage(userId, packageId, req);

        assertNotNull(res);
        assertEquals(packageId, res.packageId());
        assertEquals(new BigDecimal("500.0000"), res.creditAmount());
        assertEquals(new BigDecimal("510.0000"), res.newBalance());
        assertEquals(new BigDecimal("510.0000"), account.getBalance());

        verify(creditTransactionRepository).save(any(CreditTransaction.class));
    }

    @Test
    void testPurchasePackage_WhenInactive_ThrowsAppException() {
        UUID packageId = UUID.randomUUID();
        CreditPackage pkg = new CreditPackage();
        pkg.setId(packageId);
        pkg.setActive(false);
        when(creditPackageRepository.findById(packageId)).thenReturn(Optional.of(pkg));

        PurchaseCreditPackageRequest req = new PurchaseCreditPackageRequest("PAY-12345");
        AppException ex = assertThrows(AppException.class, () ->
                creditService.purchasePackage(userId, packageId, req)
        );

        assertEquals(ErrorCode.CREDIT_PACKAGE_INACTIVE, ex.getErrorCode());
        verify(creditAccountRepository, never()).save(any());
    }
}
