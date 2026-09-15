package com.app.modules.notification.service;

import java.util.UUID;

/**
 * Interface provided by Member A for Member B to send notifications
 * when job or batch changes status (COMPLETED, FAILED, NEEDS_RERUN).
 * See CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §4.
 */
public interface NotificationService {

    void notify(UUID workspaceId, UUID userId, String type, UUID refId, String message);
}
