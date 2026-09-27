package com.app.modules.notification.service.impl;

import com.app.common.dto.PageResponse;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.notification.dto.MarkAllNotificationsReadResponse;
import com.app.modules.notification.dto.NotificationResponse;
import com.app.modules.notification.entity.Notification;
import com.app.modules.notification.entity.NotificationType;
import com.app.modules.notification.repository.NotificationRepository;
import com.app.modules.notification.service.NotificationService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
public class NotificationServiceImpl implements NotificationService {

    private final NotificationRepository notificationRepository;
    private final WorkspaceAccessService workspaceAccessService;

    public NotificationServiceImpl(NotificationRepository notificationRepository,
                                   WorkspaceAccessService workspaceAccessService) {
        this.notificationRepository = notificationRepository;
        this.workspaceAccessService = workspaceAccessService;
    }

    @Override
    @Transactional
    public void notify(UUID workspaceId, UUID userId, String type, UUID refId, String message) {
        // 1. Verify user is currently a member of the workspace (silent no-op if not, per AC-NOTIF-02)
        try {
            workspaceAccessService.getRole(workspaceId, userId);
        } catch (AppException e) {
            log.debug("Skip notification {} for entity {}: user {} is not a member of workspace {}",
                    type, refId, userId, workspaceId);
            return;
        }

        // 2. Parse NotificationType
        NotificationType notificationType;
        try {
            notificationType = NotificationType.valueOf(type.toUpperCase());
        } catch (Exception e) {
            log.warn("Invalid notification type '{}' for entity {}: ignoring", type, refId);
            return;
        }

        // 3. Deduplication: skip if the latest notification for (workspaceId, userId, refId) has same type
        if (refId != null) {
            boolean duplicate = notificationRepository
                    .findFirstByWorkspaceIdAndUserIdAndRefIdOrderByCreatedAtDesc(workspaceId, userId, refId)
                    .map(latest -> latest.getType() == notificationType)
                    .orElse(false);
            if (duplicate) {
                log.debug("Dedup notification {} for entity {}: same as latest status", type, refId);
                return;
            }
        }

        // 4. Save notification
        Notification notification = new Notification();
        notification.setWorkspaceId(workspaceId);
        notification.setUserId(userId);
        notification.setType(notificationType);
        notification.setRefId(refId);
        notification.setMessage(message != null ? message : "");
        notification.setCreatedAt(Instant.now());
        notificationRepository.save(notification);

        log.info("Persisted notification {} for user={} in workspace={} refId={}",
                notificationType, userId, workspaceId, refId);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponse<NotificationResponse> listNotifications(UUID workspaceId, UUID userId, Boolean unreadOnly, int page, int size) {
        workspaceAccessService.requireRole(workspaceId, userId, Role.LEAD, Role.MEMBER, Role.CLIENT);

        int validatedPage = Math.max(0, page);
        int validatedSize = Math.max(1, Math.min(size, 100)); // Default 20, max 100 per API_Contract §0
        Pageable pageable = PageRequest.of(validatedPage, validatedSize);

        Page<Notification> notificationPage;
        if (Boolean.TRUE.equals(unreadOnly)) {
            notificationPage = notificationRepository.findByWorkspaceIdAndUserIdAndReadAtIsNullOrderByCreatedAtDesc(
                    workspaceId, userId, pageable);
        } else if (Boolean.FALSE.equals(unreadOnly)) {
            notificationPage = notificationRepository.findByWorkspaceIdAndUserIdAndReadAtIsNotNullOrderByCreatedAtDesc(
                    workspaceId, userId, pageable);
        } else {
            notificationPage = notificationRepository.findByWorkspaceIdAndUserIdOrderByCreatedAtDesc(
                    workspaceId, userId, pageable);
        }

        List<NotificationResponse> items = notificationPage.getContent().stream()
                .map(NotificationResponse::from)
                .toList();

        return new PageResponse<>(
                items,
                notificationPage.getNumber(),
                notificationPage.getSize(),
                notificationPage.getTotalElements(),
                notificationPage.getTotalPages()
        );
    }

    @Override
    @Transactional
    public NotificationResponse markAsRead(UUID workspaceId, UUID userId, UUID notificationId) {
        workspaceAccessService.requireRole(workspaceId, userId, Role.LEAD, Role.MEMBER, Role.CLIENT);

        Notification notification = notificationRepository.findByIdAndWorkspaceIdAndUserId(notificationId, workspaceId, userId)
                .orElseThrow(() -> new AppException(ErrorCode.NOTIFICATION_NOT_FOUND));

        if (notification.getReadAt() == null) {
            notification.setReadAt(Instant.now());
            notification = notificationRepository.save(notification);
        }

        return NotificationResponse.from(notification);
    }

    @Override
    @Transactional
    public MarkAllNotificationsReadResponse markAllAsRead(UUID workspaceId, UUID userId) {
        workspaceAccessService.requireRole(workspaceId, userId, Role.LEAD, Role.MEMBER, Role.CLIENT);

        int updatedCount = notificationRepository.markAllAsRead(workspaceId, userId, Instant.now());
        return new MarkAllNotificationsReadResponse(updatedCount);
    }
}
