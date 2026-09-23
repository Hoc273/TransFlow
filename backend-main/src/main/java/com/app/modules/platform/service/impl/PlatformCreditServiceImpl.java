package com.app.modules.platform.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.credit.dto.AdminCreditAdjustResponse;
import com.app.modules.credit.service.CreditService;
import com.app.modules.platform.dto.PlatformUserCreditBalanceResponse;
import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.PlatformCreditService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.UUID;

@Service
public class PlatformCreditServiceImpl implements PlatformCreditService {

    private final PlatformAdminAccessService accessService;
    private final UserRepository userRepository;
    private final CreditService creditService;

    public PlatformCreditServiceImpl(PlatformAdminAccessService accessService,
                                     UserRepository userRepository,
                                     CreditService creditService) {
        this.accessService = accessService;
        this.userRepository = userRepository;
        this.creditService = creditService;
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

    private void requireUserExists(UUID userId) {
        if (!userRepository.existsById(userId)) {
            throw new AppException(ErrorCode.RESOURCE_NOT_FOUND);
        }
    }
}
