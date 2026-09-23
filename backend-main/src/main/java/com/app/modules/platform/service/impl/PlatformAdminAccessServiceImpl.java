package com.app.modules.platform.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.platform.entity.PlatformUserView;
import com.app.modules.platform.repository.PlatformUserViewRepository;
import com.app.modules.platform.service.PlatformAdminAccessService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class PlatformAdminAccessServiceImpl implements PlatformAdminAccessService {

    private final PlatformUserViewRepository userViewRepository;

    public PlatformAdminAccessServiceImpl(PlatformUserViewRepository userViewRepository) {
        this.userViewRepository = userViewRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public UUID requirePlatformAdmin(UUID userId) {
        PlatformUserView user = userViewRepository.findById(userId)
                .orElseThrow(() -> new AppException(ErrorCode.USER_NOT_FOUND));
        if (!user.isPlatformAdmin()) {
            throw new AppException(ErrorCode.UNAUTHORIZED);
        }
        return user.getId();
    }
}
