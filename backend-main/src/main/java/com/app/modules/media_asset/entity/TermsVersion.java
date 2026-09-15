package com.app.modules.media_asset.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/**
 * Copyright terms version (Database_Design.md §6). Exactly one row has
 * {@code isCurrent = true} at a time (partial unique index ux_terms_versions_current).
 */
@Entity
@Table(name = "terms_versions")
@Getter
@Setter
public class TermsVersion {

    @Id
    @Column(nullable = false, updatable = false)
    private String version;

    @Column(name = "content_ref", nullable = false)
    private String contentRef;

    @Column(name = "is_current", nullable = false)
    private boolean current;

    @Column(name = "published_at", nullable = false)
    private Instant publishedAt;
}
