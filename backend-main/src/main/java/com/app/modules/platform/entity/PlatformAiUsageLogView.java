package com.app.modules.platform.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import org.hibernate.annotations.Immutable;

import java.time.Instant;
import java.util.UUID;

/**
 * Read-only view of {@code ai_usage_logs} for platform overview aggregates
 * (written by module media_job; platform only reads — same precedent as
 * {@code dashboard/entity/AiUsageLog}).
 */
@Entity
@Table(name = "ai_usage_logs")
@Immutable
@Getter
public class PlatformAiUsageLogView {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(name = "media_job_id", updatable = false)
    private UUID mediaJobId;

    @Column(nullable = false, updatable = false)
    private String operation;

    @Column(name = "input_tokens", updatable = false)
    private Integer inputTokens;

    @Column(name = "output_tokens", updatable = false)
    private Integer outputTokens;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
