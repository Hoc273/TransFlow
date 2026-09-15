package com.app.modules.notification.service.impl;

import com.app.modules.notification.service.NotificationService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Placeholder implementation pending Member A's full notification module
 * (Backend_Java_TaskSplit_MemberB.md §4 — mock permitted while A's module is unfinished).
 * Logs instead of persisting to {@code notifications} so callers (media_job) are not blocked.
 */
@Slf4j
@Service
public class NotificationServiceImpl implements NotificationService {

    @Override
    public void notify(UUID workspaceId, UUID userId, String type, UUID refId, String message) {
        log.info("[notification stub] workspace={} user={} type={} refId={} message={}",
                workspaceId, userId, type, refId, message);
    }
}
