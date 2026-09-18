package com.app.modules.dashboard.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import org.hibernate.annotations.Immutable;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Read-only JPA entity mapping table ai_usage_logs (Database_Design.md §10).
 * Marked as @Immutable per CLAUDE_A.md §4.8 & §8.2: module dashboard only reads, never writes to this table.
 */
@Entity
@Table(name = "ai_usage_logs")
@Immutable
@Getter
public class AiUsageLog {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "media_job_id", updatable = false)
    private UUID mediaJobId;

    @Column(name = "performed_by_user_id", nullable = false, updatable = false)
    private UUID performedByUserId;

    @Column(nullable = false, updatable = false)
    private String operation;

    @Column(name = "used_personal_api_key", nullable = false, updatable = false)
    private boolean usedPersonalApiKey;

    @Column(name = "input_tokens", updatable = false)
    private Integer inputTokens;

    @Column(name = "output_tokens", updatable = false)
    private Integer outputTokens;

    @Column(name = "credit_used", nullable = false, precision = 14, scale = 4, updatable = false)
    private BigDecimal creditUsed;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
