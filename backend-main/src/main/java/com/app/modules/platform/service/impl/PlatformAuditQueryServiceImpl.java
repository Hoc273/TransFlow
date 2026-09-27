package com.app.modules.platform.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.platform.dto.PlatformAuditLogItem;
import com.app.modules.platform.dto.PlatformPageResponse;
import com.app.modules.platform.entity.PlatformAdminAuditAction;
import com.app.modules.platform.entity.PlatformAdminAuditLog;
import com.app.modules.platform.repository.PlatformAdminAuditLogRepository;
import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.PlatformAuditQueryService;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class PlatformAuditQueryServiceImpl implements PlatformAuditQueryService {

    private static final int DEFAULT_SIZE = 20;
    private static final int MAX_SIZE = 100; // API_Contract.md §0

    private final PlatformAdminAccessService accessService;
    private final PlatformAdminAuditLogRepository repository;

    public PlatformAuditQueryServiceImpl(PlatformAdminAccessService accessService,
                                         PlatformAdminAuditLogRepository repository) {
        this.accessService = accessService;
        this.repository = repository;
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformPageResponse<PlatformAuditLogItem> list(UUID callerId, String action,
                                                         Integer page, Integer size) {
        accessService.requirePlatformAdmin(callerId);
        PlatformAdminAuditAction filter = parseAction(action);
        int p = page == null || page < 0 ? 0 : page;
        int s = size == null || size <= 0 ? DEFAULT_SIZE : Math.min(size, MAX_SIZE);
        PageRequest pr = PageRequest.of(p, s, Sort.by(Sort.Direction.DESC, "createdAt"));
        return PlatformPageResponse.from(repository.findFiltered(filter, pr).map(this::toItem));
    }

    private PlatformAuditLogItem toItem(PlatformAdminAuditLog row) {
        return new PlatformAuditLogItem(
                row.getId(),
                row.getActorUserId(),
                row.getAction() != null ? row.getAction().name() : null,
                row.getHttpMethod(),
                row.getPath(),
                row.getQueryString(),
                row.getIp(),
                row.getUserAgent(),
                row.getStatusCode(),
                row.getCreatedAt());
    }

    private static PlatformAdminAuditAction parseAction(String action) {
        if (action == null || action.isBlank()) {
            return null;
        }
        try {
            return PlatformAdminAuditAction.valueOf(action.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
    }
}
