package com.app.modules.credit.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Write model for the append-only AI usage ledger consumed by dashboard queries. */
@Entity
@Table(name = "ai_usage_logs")
public class AiUsageLogEntry {

    @Id
    @UuidGenerator
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

    public void setWorkspaceId(UUID workspaceId) { this.workspaceId = workspaceId; }
    public void setProjectId(UUID projectId) { this.projectId = projectId; }
    public void setMediaJobId(UUID mediaJobId) { this.mediaJobId = mediaJobId; }
    public void setPerformedByUserId(UUID performedByUserId) { this.performedByUserId = performedByUserId; }
    public void setOperation(String operation) { this.operation = operation; }
    public void setUsedPersonalApiKey(boolean usedPersonalApiKey) { this.usedPersonalApiKey = usedPersonalApiKey; }
    public void setInputTokens(Integer inputTokens) { this.inputTokens = inputTokens; }
    public void setOutputTokens(Integer outputTokens) { this.outputTokens = outputTokens; }
    public void setCreditUsed(BigDecimal creditUsed) { this.creditUsed = creditUsed; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
