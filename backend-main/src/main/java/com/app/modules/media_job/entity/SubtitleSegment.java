package com.app.modules.media_job.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.util.UUID;

/**
 * Subtitle line of a media job's translation output (Database_Design.md §8.1).
 */
@Entity
@Table(name = "subtitle_segments")
@Getter
@Setter
public class SubtitleSegment {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "media_job_id", nullable = false)
    private UUID mediaJobId;

    @Column(nullable = false)
    private int seq;

    @Enumerated(EnumType.STRING)
    @Column(name = "content_source", nullable = false, length = 30)
    private ContentSource contentSource;

    @Column(name = "source_text")
    private String sourceText;

    @Column(name = "target_text", nullable = false)
    private String targetText;

    @Column(name = "start_ms", nullable = false)
    private long startMs;

    @Column(name = "end_ms", nullable = false)
    private long endMs;

    @Column(name = "tts_audio_ref")
    private String ttsAudioRef;

    /** SHA-256 of (protocol, vendor voice, target text) the clip in {@code ttsAudioRef} was made from (V14). */
    @Column(name = "tts_clip_key", length = 64)
    private String ttsClipKey;

    @Column(name = "tts_duration_ms")
    private Long ttsDurationMs;

    public enum ContentSource {
        TRANSLATED_ORIGINAL, AUTHORED_SCRIPT, TRANSLATED_SCRIPT
    }
}
