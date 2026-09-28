package com.app.modules.auth.entity;

import com.app.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * One signed-in device (V4__auth_sessions.sql). The refresh token is derived from
 * {@code id + generation}, so no token material is stored here.
 */
@Entity
@Table(name = "auth_sessions")
@Getter
@Setter
public class AuthSession extends BaseEntity {

    /** Plain column (no FK mapping): the DB cascades user deletes. */
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private int generation = 1;

    @Column(name = "rotated_at")
    private Instant rotatedAt;

    @Column(name = "last_used_at", nullable = false)
    private Instant lastUsedAt;

    /** Absolute lifetime cap, set at sign-in. */
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "revoked_reason", length = 32)
    private AuthSessionRevokeReason revokedReason;

    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @Column(name = "ip_address", length = 64)
    private String ipAddress;
}
