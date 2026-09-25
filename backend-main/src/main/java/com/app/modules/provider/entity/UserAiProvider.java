package com.app.modules.provider.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * BYOK (Bring Your Own Key) personal AI provider per user (Database_Design.md §5).
 */
@Entity
@Table(name = "user_ai_providers")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class UserAiProvider {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private String protocol;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(nullable = false)
    private List<String> capabilities = new ArrayList<>();

    @Column(name = "base_url", nullable = false, length = 500)
    private String baseUrl;

    @Column(name = "api_key_enc", nullable = false)
    private byte[] apiKeyEnc;

    @Column(name = "api_key_hint", nullable = false, length = 20)
    private String apiKeyHint;

    @Column(name = "default_model", length = 200)
    private String defaultModel;

    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;

    /** Result of the daily key check; a DOWN key is still used (the user chose it) but flagged. */
    @Enumerated(EnumType.STRING)
    @Column(name = "health_status", nullable = false, length = 10)
    private PlatformAiProvider.HealthStatus healthStatus = PlatformAiProvider.HealthStatus.UNKNOWN;

    @Column(name = "last_checked_at")
    private Instant lastCheckedAt;

    @Column(name = "last_error_code", length = 80)
    private String lastErrorCode;

    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }

    public boolean hasCapability(String capability) {
        if (capabilities == null || capability == null) {
            return false;
        }
        return capabilities.stream().anyMatch(c -> c.equalsIgnoreCase(capability));
    }
}
