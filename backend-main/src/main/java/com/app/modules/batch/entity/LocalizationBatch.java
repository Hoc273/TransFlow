package com.app.modules.batch.entity;

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

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Video Batch Localization (Database_Design.md §6.1). v1.4: {@code target_lang} is a single scalar
 * value — NOT an array — so all child jobs share exactly one target language.
 */
@Entity
@Table(name = "localization_batches")
@Getter
@Setter
public class LocalizationBatch {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(length = 200)
    private String name;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "source_asset_ids", nullable = false)
    private List<UUID> sourceAssetIds;

    @Column(name = "target_lang", nullable = false)
    private String targetLang;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "shared_config", nullable = false)
    private String sharedConfig = "{}";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private BatchStatus status = BatchStatus.PENDING;

    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** {@code PARTIALLY_FAILED} only ever exists here — {@code media_jobs.status} never takes this value. */
    public enum BatchStatus {
        PENDING, PROCESSING, PARTIALLY_FAILED, COMPLETED, FAILED, CANCELLED
    }
}
