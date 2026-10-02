package com.app.modules.platform.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;
import java.util.UUID;

/**
 * Append-only activity of regular users: every authenticated data-changing request outside
 * {@code /api/platform/**}, plus failed logins (no user). Purged after the retention window.
 */
@Entity
@Table(name = "user_activity_logs")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
public class UserActivityLog {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    /** Null for failed logins. */
    @Column(name = "user_id")
    private UUID userId;

    /** Taken from {@code /api/workspaces/{id}/...}; null for requests outside a workspace. */
    @Column(name = "workspace_id")
    private UUID workspaceId;

    /** Method plus path with ids replaced, e.g. {@code POST /api/workspaces/{id}/media/jobs}. */
    @Column(nullable = false, length = 160)
    private String action;

    @Column(name = "http_method", nullable = false, length = 10)
    private String httpMethod;

    @Column(nullable = false, length = 512)
    private String path;

    @Column(length = 64)
    private String ip;

    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @Column(name = "status_code", nullable = false)
    private int statusCode;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
