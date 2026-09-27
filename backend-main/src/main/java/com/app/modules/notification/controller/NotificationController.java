package com.app.modules.notification.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.dto.PageResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.notification.dto.MarkAllNotificationsReadResponse;
import com.app.modules.notification.dto.NotificationResponse;
import com.app.modules.notification.service.NotificationService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Controller for Notification APIs (API_Contract.md §12).
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    /**
     * GET /api/workspaces/{workspaceId}/notifications?unread=true&page=0&size=20
     * List notifications của user hiện tại trong Workspace.
     */
    @GetMapping
    public ApiResponse<PageResponse<NotificationResponse>> listNotifications(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId,
            @RequestParam(required = false) Boolean unread,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        PageResponse<NotificationResponse> response = notificationService.listNotifications(
                workspaceId, user.id(), unread, page, size);
        return ApiResponse.<PageResponse<NotificationResponse>>builder()
                .data(response)
                .build();
    }

    /**
     * POST /api/workspaces/{workspaceId}/notifications/{id}/read
     * Đánh dấu 1 thông báo đã đọc.
     */
    @PostMapping("/{id}/read")
    public ApiResponse<NotificationResponse> markAsRead(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId,
            @PathVariable UUID id) {
        NotificationResponse response = notificationService.markAsRead(workspaceId, user.id(), id);
        return ApiResponse.<NotificationResponse>builder()
                .data(response)
                .build();
    }

    /**
     * POST /api/workspaces/{workspaceId}/notifications/read-all
     * Đánh dấu toàn bộ thông báo chưa đọc của user trong Workspace là đã đọc.
     */
    @PostMapping("/read-all")
    public ApiResponse<MarkAllNotificationsReadResponse> markAllAsRead(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId) {
        MarkAllNotificationsReadResponse response = notificationService.markAllAsRead(workspaceId, user.id());
        return ApiResponse.<MarkAllNotificationsReadResponse>builder()
                .data(response)
                .build();
    }
}
