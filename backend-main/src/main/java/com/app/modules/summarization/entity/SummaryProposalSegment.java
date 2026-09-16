package com.app.modules.summarization.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * One matched video segment of a {@link SummaryProposal} (Database_Design.md §7).
 */
@Entity
@Table(name = "summary_proposal_segments")
@Getter
@Setter
public class SummaryProposalSegment {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "proposal_id", nullable = false)
    private UUID proposalId;

    @Column(nullable = false)
    private int seq;

    @Column(name = "start_ms", nullable = false)
    private long startMs;

    @Column(name = "end_ms", nullable = false)
    private long endMs;

    @Column(name = "script_excerpt")
    private String scriptExcerpt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "source_sentence_refs", nullable = false)
    private String sourceSentenceRefs = "[]";

    @Column(name = "reasoning_note")
    private String reasoningNote;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
