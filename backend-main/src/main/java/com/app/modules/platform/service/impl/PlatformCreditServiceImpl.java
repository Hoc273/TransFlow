package com.app.modules.platform.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.credit.dto.AdminCreditAdjustResponse;
import com.app.modules.credit.dto.CreditPurchaseResponse;
import com.app.modules.credit.entity.CreditPurchaseStatus;
import com.app.modules.credit.service.CreditService;
import com.app.modules.platform.dto.PlatformCreditPurchaseItem;
import com.app.modules.platform.dto.PlatformPageResponse;
import com.app.modules.platform.dto.PlatformUserCreditBalanceResponse;
import com.app.modules.platform.entity.PlatformUserView;
import com.app.modules.platform.repository.PlatformUserViewRepository;
import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.PlatformCreditService;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class PlatformCreditServiceImpl implements PlatformCreditService {

    private final PlatformAdminAccessService accessService;
    private final UserRepository userRepository;
    private final CreditService creditService;
    private final PlatformUserViewRepository userViewRepository;

    public PlatformCreditServiceImpl(PlatformAdminAccessService accessService,
                                     UserRepository userRepository,
                                     CreditService creditService,
                                     PlatformUserViewRepository userViewRepository) {
        this.accessService = accessService;
        this.userRepository = userRepository;
        this.creditService = creditService;
        this.userViewRepository = userViewRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformUserCreditBalanceResponse getUserBalance(UUID callerId, UUID targetUserId) {
        accessService.requirePlatformAdmin(callerId);
        requireUserExists(targetUserId);
        return new PlatformUserCreditBalanceResponse(targetUserId, creditService.getBalance(targetUserId));
    }

    @Override
    @Transactional
    public AdminCreditAdjustResponse adjustUserCredit(UUID callerId, UUID targetUserId,
                                                      BigDecimal amount, String reason) {
        accessService.requirePlatformAdmin(callerId);
        requireUserExists(targetUserId);
        String normalizedReason = reason == null || reason.isBlank() ? null : reason.trim();
        return creditService.adminAdjustCredit(callerId, targetUserId, amount, normalizedReason);
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformPageResponse<PlatformCreditPurchaseItem> listPurchases(UUID callerId, CreditPurchaseStatus status,
                                                                          int page, int size) {
        accessService.requirePlatformAdmin(callerId);
        Page<CreditPurchaseResponse> purchases = creditService.listPurchases(status, page, size);
        Map<UUID, PlatformUserView> users = userViewRepository.findAllById(
                        purchases.getContent().stream().map(CreditPurchaseResponse::userId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(PlatformUserView::getId, Function.identity()));
        return PlatformPageResponse.from(purchases.map(p -> withUser(p, users.get(p.userId()))));
    }

    @Override
    @Transactional
    public PlatformCreditPurchaseItem approvePurchase(UUID callerId, UUID purchaseId, String note) {
        accessService.requirePlatformAdmin(callerId);
        return withUser(creditService.approvePurchase(callerId, purchaseId, note));
    }

    @Override
    @Transactional
    public PlatformCreditPurchaseItem rejectPurchase(UUID callerId, UUID purchaseId, String note) {
        accessService.requirePlatformAdmin(callerId);
        return withUser(creditService.rejectPurchase(callerId, purchaseId, note));
    }

    private PlatformCreditPurchaseItem withUser(CreditPurchaseResponse purchase) {
        return withUser(purchase, userViewRepository.findById(purchase.userId()).orElse(null));
    }

    private static PlatformCreditPurchaseItem withUser(CreditPurchaseResponse purchase, PlatformUserView user) {
        return PlatformCreditPurchaseItem.of(purchase,
                user != null ? user.getEmail() : null, user != null ? user.getFullName() : null);
    }

    private void requireUserExists(UUID userId) {
        if (!userRepository.existsById(userId)) {
            throw new AppException(ErrorCode.RESOURCE_NOT_FOUND);
        }
    }
}
