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
 * Platform-wide AI provider fallback (Database_Design.md §5).
 */
@Entity
@Table(name = "platform_ai_providers")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PlatformAiProvider {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false)
    private String protocol;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(nullable = false)
    private List<String> capabilities = new ArrayList<>();

    @Column(name = "base_url", nullable = false, length = 500)
    private String baseUrl;

    @Column(name = "api_key_enc", nullable = false)
    private byte[] apiKeyEnc;

    @Column(name = "default_model", length = 200)
    private String defaultModel;

    @Column(name = "api_key_hint", length = 20)
    private String apiKeyHint;

    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;

    /** Pool order: the lowest priority value with an available key wins. */
    @Column(nullable = false)
    private short priority = 100;

    /** Weighted random share among available keys of the same priority. */
    @Column(nullable = false)
    private short weight = 1;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Tier tier = Tier.PAID;

    @Enumerated(EnumType.STRING)
    @Column(name = "health_status", nullable = false, length = 10)
    private HealthStatus healthStatus = HealthStatus.UNKNOWN;

    @Column(name = "last_checked_at")
    private Instant lastCheckedAt;

    @Column(name = "last_error_code", length = 80)
    private String lastErrorCode;

    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    /** PAID = billed provider account; FREE = free-tier pool such as FreeLLMAPI. */
    public enum Tier { PAID, FREE }

    public enum HealthStatus { UNKNOWN, HEALTHY, DOWN }

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        if (name == null || name.isBlank()) {
            name = protocol;
        }
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
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
