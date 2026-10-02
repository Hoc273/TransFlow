package com.app.modules.platform.service.impl;

import com.app.modules.platform.dto.PlatformPageResponse;
import com.app.modules.platform.dto.UserActivityLogItem;
import com.app.modules.platform.entity.PlatformUserView;
import com.app.modules.platform.entity.UserActivityLog;
import com.app.modules.platform.repository.PlatformUserViewRepository;
import com.app.modules.platform.repository.UserActivityLogRepository;
import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.UserActivityLogService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class UserActivityLogServiceImpl implements UserActivityLogService {

    private static final Logger log = LoggerFactory.getLogger(UserActivityLogServiceImpl.class);
    private static final Pattern UUID_SEGMENT = Pattern.compile(
            "/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=/|$)");
    private static final Pattern NUMBER_SEGMENT = Pattern.compile("/\\d+(?=/|$)");
    private static final Pattern WORKSPACE_ID = Pattern.compile(
            "^/api/workspaces/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:/|$)");

    private final UserActivityLogRepository repository;
    private final PlatformUserViewRepository userViewRepository;
    private final PlatformAdminAccessService accessService;
    private final Duration retention;

    public UserActivityLogServiceImpl(UserActivityLogRepository repository,
                                      PlatformUserViewRepository userViewRepository,
                                      PlatformAdminAccessService accessService,
                                      @Value("${app.activity-log.retention-days:90}") int retentionDays) {
        this.repository = repository;
        this.userViewRepository = userViewRepository;
        this.accessService = accessService;
        this.retention = Duration.ofDays(Math.max(1, retentionDays));
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(UUID userId, HttpServletRequest request, int statusCode) {
        try {
            String path = request.getRequestURI();
            UserActivityLog row = new UserActivityLog();
            row.setUserId(userId);
            row.setWorkspaceId(workspaceIdOf(path));
            row.setAction(truncate(actionOf(request.getMethod(), path), 160));
            row.setHttpMethod(truncate(request.getMethod(), 10));
            row.setPath(truncate(path, 512));
            row.setIp(truncate(PlatformAdminAuditServiceImpl.clientIp(request), 64));
            row.setUserAgent(truncate(request.getHeader("User-Agent"), 512));
            row.setStatusCode(statusCode);
            repository.save(row);
        } catch (Exception ex) {
            log.warn("user_activity_write_failed path={}: {}", request.getRequestURI(), ex.toString());
        }
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformPageResponse<UserActivityLogItem> list(UUID callerId, UUID userId, UUID workspaceId, String q,
                                                          boolean failedOnly, Integer page, Integer size) {
        accessService.requirePlatformAdmin(callerId);
        String needle = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        Page<UserActivityLog> rows = repository.search(userId, workspaceId, needle, failedOnly,
                PageRequest.of(page == null ? 0 : Math.max(0, page),
                        size == null ? 20 : Math.max(1, Math.min(size, 100))));
        Map<UUID, String> emails = userViewRepository.findAllById(
                        rows.getContent().stream().map(UserActivityLog::getUserId)
                                .filter(java.util.Objects::nonNull).distinct().toList())
                .stream()
                .collect(Collectors.toMap(PlatformUserView::getId, PlatformUserView::getEmail));
        return PlatformPageResponse.from(rows.map(a -> new UserActivityLogItem(
                a.getId(), a.getUserId(), a.getUserId() != null ? emails.get(a.getUserId()) : null,
                a.getWorkspaceId(), a.getAction(), a.getHttpMethod(), a.getPath(), a.getIp(), a.getUserAgent(),
                a.getStatusCode(), a.getCreatedAt())));
    }

    @Scheduled(cron = "${app.maintenance.activity-log-cleanup-cron:0 50 3 * * *}")
    @Transactional
    public void purgeExpired() {
        int deleted = repository.deleteOlderThan(Instant.now().minus(retention));
        if (deleted > 0) {
            log.info("user_activity_purged rows={} retentionDays={}", deleted, retention.toDays());
        }
    }

    /** {@code POST /api/workspaces/{id}/media/jobs} — ids collapsed so actions group and filter. */
    static String actionOf(String method, String path) {
        String normalized = UUID_SEGMENT.matcher(path == null ? "" : path).replaceAll("/{id}");
        normalized = NUMBER_SEGMENT.matcher(normalized).replaceAll("/{n}");
        return method + " " + normalized;
    }

    static UUID workspaceIdOf(String path) {
        Matcher m = WORKSPACE_ID.matcher(path == null ? "" : path);
        return m.find() ? UUID.fromString(m.group(1)) : null;
    }

    private static String truncate(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max);
    }
}
