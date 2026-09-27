package com.app.modules.qa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.UUID;

/** Always-kept audit trail of a {@link QaIssue} override (Database_Design.md §8.3). */
@Entity
@Table(name = "qa_issue_overrides")
@Getter
@Setter
public class QaIssueOverride {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "qa_issue_id", nullable = false)
    private UUID qaIssueId;

    @Column(name = "overridden_by", nullable = false)
    private UUID overriddenBy;

    /** CHECK char_length(reason) >= 10 at the DB level — also enforced in service for a clean error. */
    @Column(nullable = false)
    private String reason;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
