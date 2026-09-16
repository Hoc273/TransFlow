package com.app.modules.summarization.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Script-first summarization proposal (Database_Design.md §7). AI proposals carry the authored
 * script + confidence/warnings; HUMAN (Custom Proposal) ones leave those NULL per
 * {@code ck_proposal_origin_fields} — segments are picked directly from the original transcript instead.
 */
@Entity
@Table(name = "summary_proposals")
@Getter
@Setter
public class SummaryProposal {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "media_job_stage_id", nullable = false)
    private UUID mediaJobStageId;

    @Enumerated(EnumType.STRING)
    @Column(name = "generated_by", nullable = false, length = 10)
    private GeneratedBy generatedBy;

    @Column(name = "generation_round", nullable = false)
    private short generationRound = 1;

    @Column(name = "feedback_text")
    private String feedbackText;

    @Column(name = "script_content")
    private String scriptContent;

    @Column(name = "script_language")
    private String scriptLanguage;

    @Column(name = "reasoning_note")
    private String reasoningNote;

    @Column(name = "total_duration_ms")
    private Long totalDurationMs;

    @Column(precision = 3, scale = 2)
    private BigDecimal confidence;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String warnings = "[]";

    @Column(name = "archived_at")
    private Instant archivedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public enum GeneratedBy { AI, HUMAN }
}
