package com.app.modules.platform.service.impl;

import com.app.modules.platform.dto.PlatformPageResponse;
import com.app.modules.platform.dto.PlatformUserItem;
import com.app.modules.platform.dto.PlatformWorkspaceItem;
import com.app.modules.platform.repository.PlatformUserViewRepository;
import com.app.modules.platform.repository.PlatformWorkspaceViewRepository;
import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.PlatformDirectoryService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class PlatformDirectoryServiceImpl implements PlatformDirectoryService {

    private static final int DEFAULT_SIZE = 20;
    private static final int MAX_SIZE = 100; // API_Contract.md §0

    private final PlatformAdminAccessService accessService;
    private final PlatformUserViewRepository userViewRepository;
    private final PlatformWorkspaceViewRepository workspaceViewRepository;

    public PlatformDirectoryServiceImpl(PlatformAdminAccessService accessService,
                                        PlatformUserViewRepository userViewRepository,
                                        PlatformWorkspaceViewRepository workspaceViewRepository) {
        this.accessService = accessService;
        this.userViewRepository = userViewRepository;
        this.workspaceViewRepository = workspaceViewRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformPageResponse<PlatformUserItem> listUsers(UUID callerId, String q,
                                                          Boolean isPlatformAdmin,
                                                          Integer page, Integer size) {
        accessService.requirePlatformAdmin(callerId);
        Page<PlatformUserViewRepository.PlatformUserRow> rows =
                userViewRepository.searchDirectory(normalizeQuery(q), isPlatformAdmin,
                        pageRequest(page, size));
        return PlatformPageResponse.from(rows.map(r -> new PlatformUserItem(
                r.getId(),
                r.getEmail(),
                r.getFullName(),
                r.getStatus(),
                Boolean.TRUE.equals(r.getPlatformAdmin()),
                r.getCreatedAt(),
                r.getWorkspaceCount() != null ? r.getWorkspaceCount() : 0L,
                r.getAvatarUrl())));
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformPageResponse<PlatformWorkspaceItem> listWorkspaces(UUID callerId, String q,
                                                                      Integer page, Integer size) {
        accessService.requirePlatformAdmin(callerId);
        Page<PlatformWorkspaceViewRepository.PlatformWorkspaceRow> rows =
                workspaceViewRepository.searchDirectory(normalizeQuery(q), pageRequest(page, size));
        return PlatformPageResponse.from(rows.map(r -> new PlatformWorkspaceItem(
                r.getId(),
                r.getName(),
                r.getSlug(),
                r.getOwnerUserId(),
                r.getOwnerEmail(),
                r.getMemberCount() != null ? r.getMemberCount() : 0L,
                r.getCreatedAt())));
    }

    /** page/size are clamped, never rejected (size > 100 → 100, per contract §13.1 note). */
    private static PageRequest pageRequest(Integer page, Integer size) {
        int p = page == null || page < 0 ? 0 : page;
        int s = size == null || size <= 0 ? DEFAULT_SIZE : Math.min(size, MAX_SIZE);
        return PageRequest.of(p, s);
    }

    private static String normalizeQuery(String q) {
        if (q == null || q.isBlank()) {
            return null;
        }
        return q.trim();
    }
}
