package com.app.modules.notification.service;

import com.app.common.dto.PageResponse;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.notification.dto.MarkAllNotificationsReadResponse;
import com.app.modules.notification.dto.NotificationResponse;
import com.app.modules.notification.entity.Notification;
import com.app.modules.notification.entity.NotificationType;
import com.app.modules.notification.repository.NotificationRepository;
import com.app.modules.notification.service.impl.NotificationServiceImpl;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationServiceTest {

    @Mock
    private NotificationRepository notificationRepository;

    @Mock
    private WorkspaceAccessService workspaceAccessService;

    private NotificationService notificationService;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID refId = UUID.randomUUID();
    private final UUID notificationId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        notificationService = new NotificationServiceImpl(notificationRepository, workspaceAccessService);
    }

    @Test
    @DisplayName("notify: persists notification when user is member and valid type")
    void notify_persistsNotification_whenValid() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.MEMBER);
        when(notificationRepository.findFirstByWorkspaceIdAndUserIdAndRefIdOrderByCreatedAtDesc(workspaceId, userId, refId))
                .thenReturn(Optional.empty());

        notificationService.notify(workspaceId, userId, "JOB_COMPLETED", refId, "Job finished successfully");

        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(notificationRepository).save(captor.capture());
        Notification saved = captor.getValue();
        assertThat(saved.getWorkspaceId()).isEqualTo(workspaceId);
        assertThat(saved.getUserId()).isEqualTo(userId);
        assertThat(saved.getType()).isEqualTo(NotificationType.JOB_COMPLETED);
        assertThat(saved.getRefId()).isEqualTo(refId);
        assertThat(saved.getMessage()).isEqualTo("Job finished successfully");
        assertThat(saved.getReadAt()).isNull();
    }

    @Test
    @DisplayName("notify: silent no-op when user is no longer member of workspace")
    void notify_silentNoOp_whenUserNotMember() {
        when(workspaceAccessService.getRole(workspaceId, userId))
                .thenThrow(new AppException(ErrorCode.UNAUTHORIZED));

        notificationService.notify(workspaceId, userId, "JOB_FAILED", refId, "Failed");

        verify(notificationRepository, never()).save(any());
    }

    @Test
    @DisplayName("notify: silent no-op when type is invalid")
    void notify_silentNoOp_whenInvalidType() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.MEMBER);

        notificationService.notify(workspaceId, userId, "INVALID_STATUS_TYPE", refId, "msg");

        verify(notificationRepository, never()).save(any());
    }

    @Test
    @DisplayName("notify: dedup skips when latest notification has same type")
    void notify_dedupSkips_whenDuplicateStatus() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.MEMBER);

        Notification existing = new Notification();
        existing.setType(NotificationType.JOB_COMPLETED);
        when(notificationRepository.findFirstByWorkspaceIdAndUserIdAndRefIdOrderByCreatedAtDesc(workspaceId, userId, refId))
                .thenReturn(Optional.of(existing));

        notificationService.notify(workspaceId, userId, "JOB_COMPLETED", refId, "Job finished duplicate");

        verify(notificationRepository, never()).save(any());
    }

    @Test
    @DisplayName("listNotifications: returns unread only when unreadOnly is true")
    void listNotifications_unreadOnly() {
        Notification n = new Notification();
        n.setId(notificationId);
        n.setWorkspaceId(workspaceId);
        n.setUserId(userId);
        n.setType(NotificationType.JOB_COMPLETED);
        n.setMessage("Unread message");
        n.setCreatedAt(Instant.now());

        when(notificationRepository.findByWorkspaceIdAndUserIdAndReadAtIsNullOrderByCreatedAtDesc(
                eq(workspaceId), eq(userId), any()))
                .thenReturn(new PageImpl<>(List.of(n), PageRequest.of(0, 20), 1));

        PageResponse<NotificationResponse> result = notificationService.listNotifications(
                workspaceId, userId, true, 0, 20);

        verify(workspaceAccessService).requireRole(workspaceId, userId, Role.LEAD, Role.MEMBER, Role.CLIENT);
        assertThat(result.items()).hasSize(1);
        assertThat(result.items().get(0).id()).isEqualTo(notificationId);
        assertThat(result.totalElements()).isEqualTo(1);
    }

    @Test
    @DisplayName("markAsRead: sets readAt and saves when notification found")
    void markAsRead_success() {
        Notification n = new Notification();
        n.setId(notificationId);
        n.setWorkspaceId(workspaceId);
        n.setUserId(userId);
        n.setType(NotificationType.JOB_COMPLETED);
        n.setMessage("Test");
        n.setCreatedAt(Instant.now());

        when(notificationRepository.findByIdAndWorkspaceIdAndUserId(notificationId, workspaceId, userId))
                .thenReturn(Optional.of(n));
        when(notificationRepository.save(any(Notification.class))).thenAnswer(invocation -> invocation.getArgument(0));

        NotificationResponse res = notificationService.markAsRead(workspaceId, userId, notificationId);

        assertThat(res.readAt()).isNotNull();
        verify(notificationRepository).save(n);
    }

    @Test
    @DisplayName("markAsRead: throws NOTIFICATION_NOT_FOUND when not found")
    void markAsRead_notFound() {
        when(notificationRepository.findByIdAndWorkspaceIdAndUserId(notificationId, workspaceId, userId))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> notificationService.markAsRead(workspaceId, userId, notificationId))
                .isInstanceOf(AppException.class)
                .matches(e -> ((AppException) e).getErrorCode() == ErrorCode.NOTIFICATION_NOT_FOUND);
    }

    @Test
    @DisplayName("markAllAsRead: delegates to repository markAllAsRead")
    void markAllAsRead_success() {
        when(notificationRepository.markAllAsRead(eq(workspaceId), eq(userId), any(Instant.class)))
                .thenReturn(5);

        MarkAllNotificationsReadResponse res = notificationService.markAllAsRead(workspaceId, userId);

        verify(workspaceAccessService).requireRole(workspaceId, userId, Role.LEAD, Role.MEMBER, Role.CLIENT);
        assertThat(res.updatedCount()).isEqualTo(5);
    }
}
