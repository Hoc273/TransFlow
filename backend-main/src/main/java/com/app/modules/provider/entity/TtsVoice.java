package com.app.modules.provider.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Read-only mirror of {@code tts_voices} (Database_Design.md §5) — minimal mapping
 * needed by media_job to validate {@code tts_voices.language == target_lang}
 * (API_Contract.md §5, ErrorCode.VOICE_LANGUAGE_MISMATCH). Full BYOK voice
 * management (caching/refresh) belongs to Member A's provider module.
 */
@Entity
@Table(name = "tts_voices")
@Getter
@Setter
public class TtsVoice {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(nullable = false)
    private String language;
}
