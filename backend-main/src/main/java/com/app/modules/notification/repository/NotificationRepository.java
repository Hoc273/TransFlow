package com.app.modules.notification.repository;

import com.app.modules.notification.entity.Notification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    Page<Notification> findByWorkspaceIdAndUserIdOrderByCreatedAtDesc(
            UUID workspaceId, UUID userId, Pageable pageable);

    Page<Notification> findByWorkspaceIdAndUserIdAndReadAtIsNullOrderByCreatedAtDesc(
            UUID workspaceId, UUID userId, Pageable pageable);

    Page<Notification> findByWorkspaceIdAndUserIdAndReadAtIsNotNullOrderByCreatedAtDesc(
            UUID workspaceId, UUID userId, Pageable pageable);

    Optional<Notification> findByIdAndWorkspaceIdAndUserId(UUID id, UUID workspaceId, UUID userId);

    @Modifying
    @Query("update Notification n set n.readAt = :now where n.workspaceId = :workspaceId and n.userId = :userId and n.readAt is null")
    int markAllAsRead(@Param("workspaceId") UUID workspaceId, @Param("userId") UUID userId, @Param("now") Instant now);

    /** Retention: read notifications older than {@code readBefore}, any notification older than {@code anyBefore}. */
    @Modifying
    @Query("""
            delete from Notification n
            where (n.readAt is not null and n.createdAt < :readBefore) or n.createdAt < :anyBefore
            """)
    int deleteExpired(@Param("readBefore") Instant readBefore, @Param("anyBefore") Instant anyBefore);

    boolean existsByUserIdAndTypeAndRefIdAndCreatedAtAfter(UUID userId,
                                                           com.app.modules.notification.entity.NotificationType type,
                                                           UUID refId, Instant after);

    Optional<Notification> findFirstByWorkspaceIdAndUserIdAndRefIdOrderByCreatedAtDesc(
            UUID workspaceId, UUID userId, UUID refId);
}
