package com.app.modules.platform.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import org.hibernate.annotations.Immutable;

import java.time.Instant;
import java.util.UUID;

/**
 * Read-only view of {@code users} for the platform module (CLAUDE.md §4.8 boundary:
 * platform reads cross-module tables through its own @Immutable entities, like
 * {@code dashboard/entity/AiUsageLog}). Never exposes password_hash/google_sub.
 */
@Entity
@Table(name = "users")
@Immutable
@Getter
public class PlatformUserView {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(nullable = false, updatable = false)
    private String email;

    @Column(name = "full_name", nullable = false, updatable = false)
    private String fullName;

    @Column(nullable = false, updatable = false)
    private String status;

    @Column(name = "is_platform_admin", nullable = false, updatable = false)
    private boolean platformAdmin;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
