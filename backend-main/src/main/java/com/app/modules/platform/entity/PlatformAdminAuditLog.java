package com.app.modules.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;
import java.util.UUID;

/**
 * Append-only Super Admin access audit (SRS §5.8). No workspace_id —
 * platform domain only. No updated_at (immutable log rows).
 */
@Entity
@Table(name = "platform_admin_audit_logs")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
public class PlatformAdminAuditLog {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    /** Null for system seed grants. */
    @Column(name = "actor_user_id")
    private UUID actorUserId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private PlatformAdminAuditAction action;

    @Column(name = "http_method", nullable = false, length = 10)
    private String httpMethod;

    @Column(nullable = false, length = 512)
    private String path;

    @Column(name = "query_string", length = 1024)
    private String queryString;

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
