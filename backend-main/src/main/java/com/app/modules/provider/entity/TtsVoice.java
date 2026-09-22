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
 * TTS voices cache (Database_Design.md §5).
 * Holds voices offered by user BYOK providers or platform providers.
 */
@Entity
@Table(name = "tts_voices")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class TtsVoice {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "provider_source", nullable = false)
    private String providerSource = "PLATFORM"; // 'USER' or 'PLATFORM'

    @Column(name = "user_provider_id")
    private UUID userProviderId;

    @Column(name = "platform_provider_id")
    private UUID platformProviderId;

    @Column(name = "voice_id", nullable = false)
    private String voiceId = "default";

    @Column(nullable = false)
    private String language;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "languages")
    private List<String> languages = new ArrayList<>();

    @Column
    private String gender = "UNKNOWN"; // 'MALE', 'FEMALE', 'UNKNOWN'

    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;

    @Column(name = "cached_at")
    private Instant cachedAt;

    @PrePersist
    void prePersist() {
        if (this.providerSource == null) {
            this.providerSource = "PLATFORM";
        }
        if (this.voiceId == null) {
            this.voiceId = this.id != null ? this.id.toString() : "default";
        }
        if (this.cachedAt == null) {
            this.cachedAt = Instant.now();
        }
    }

    public boolean isLanguageCompatible(String targetLang) {
        if (targetLang == null) return false;
        if (targetLang.equalsIgnoreCase(this.language)) return true;
        if (this.languages != null) {
            return this.languages.stream().anyMatch(targetLang::equalsIgnoreCase);
        }
        return false;
    }
}
