package com.app.modules.notification.dto;

import com.app.modules.notification.entity.Notification;

import java.time.Instant;
import java.util.UUID;

public record NotificationResponse(
        UUID id,
        UUID workspaceId,
        UUID userId,
        String type,
        UUID refId,
        String message,
        Instant readAt,
        Instant createdAt
) {
    public static NotificationResponse from(Notification n) {
        return new NotificationResponse(
                n.getId(),
                n.getWorkspaceId(),
                n.getUserId(),
                n.getType() != null ? n.getType().name() : null,
                n.getRefId(),
                n.getMessage(),
                n.getReadAt(),
                n.getCreatedAt()
        );
    }
}
