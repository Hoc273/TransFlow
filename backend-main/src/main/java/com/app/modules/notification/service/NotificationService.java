package com.app.modules.notification.service;

import com.app.common.dto.PageResponse;
import com.app.modules.notification.dto.MarkAllNotificationsReadResponse;
import com.app.modules.notification.dto.NotificationResponse;

import java.util.UUID;

/**
 * Interface provided by Member A for Member B to send notifications
 * when job or batch changes status (COMPLETED, FAILED, NEEDS_RERUN).
 * Also handles user notification listing and mark-as-read APIs (API_Contract.md §12).
 * See CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §4.
 */
public interface NotificationService {

    /**
     * Sends a notification asynchronously/synchronously from worker callbacks or pipelines.
     */
    void notify(UUID workspaceId, UUID userId, String type, UUID refId, String message);

    /**
     * Lists notifications for current user in the workspace (paginated).
     */
    PageResponse<NotificationResponse> listNotifications(UUID workspaceId, UUID userId, Boolean unreadOnly, int page, int size);

    /**
     * Marks a single notification as read.
     */
    NotificationResponse markAsRead(UUID workspaceId, UUID userId, UUID notificationId);

    /**
     * Marks all unread notifications of the user in the workspace as read.
     */
    MarkAllNotificationsReadResponse markAllAsRead(UUID workspaceId, UUID userId);
}
