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

    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;

    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public boolean hasCapability(String capability) {
        if (capabilities == null || capability == null) {
            return false;
        }
        return capabilities.stream().anyMatch(c -> c.equalsIgnoreCase(capability));
    }
}
