package com.app.modules.media_job.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * One row per technical stage of the 8-stage pipeline (Database_Design.md §6.3).
 * Checkpoint markers (cut_confirmed/review_confirmed/publish_confirmed) live in
 * {@link #inputRef} JSONB of the stage that owns the checkpoint (System_Architecture.md §5.6).
 */
@Entity
@Table(name = "media_job_stages")
@Getter
@Setter
public class MediaJobStage {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "media_job_id", nullable = false)
    private UUID mediaJobId;

    @Enumerated(EnumType.STRING)
    @Column(name = "stage_name", nullable = false, length = 30)
    private StageName stageName;

    @Column(name = "stage_order", nullable = false)
    private short stageOrder;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private StageStatus status = StageStatus.PENDING;

    @Column(name = "progress_percent")
    private short progressPercent = 0;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "input_ref")
    private String inputRef;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "output_ref")
    private String outputRef;

    @Column(name = "worker_id")
    private String workerId;

    @Column(name = "attempt_count", nullable = false)
    private short attemptCount = 0;

    @Column(name = "execution_time_ms")
    private Long executionTimeMs;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "error_code", length = 100)
    private String errorCode;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "error_detail")
    private JsonNode errorDetail;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    public enum StageName {
        EXTRACT_AUDIO, SOURCE_SEPARATION, STT, SUMMARIZE, TRANSLATE, TTS, AUDIO_MIX, RENDER;

        public short order() {
            return (short) (ordinal() + 1);
        }
    }

    public enum StageStatus {
        PENDING, PROCESSING, COMPLETED, FAILED, STALE, SKIPPED, CANCEL_REQUESTED, CANCELLED
    }
}
