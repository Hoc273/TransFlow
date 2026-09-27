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
 * Read-only view of {@code localization_batches} for platform overview aggregates.
 * {@code PARTIALLY_FAILED} only ever exists here — {@code media_jobs.status} never
 * takes this value (Database_Design.md §7).
 */
@Entity
@Table(name = "localization_batches")
@Immutable
@Getter
public class PlatformLocalizationBatchView {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(nullable = false, updatable = false)
    private String status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
