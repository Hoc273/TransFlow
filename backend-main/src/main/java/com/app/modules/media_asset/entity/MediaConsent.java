package com.app.modules.media_asset.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.UUID;

/**
 * Consent to the current copyright terms, recorded once per root asset per
 * terms_version (Database_Design.md §6). Inherited by every derived asset of
 * the same root — never re-confirmed per derived asset (SRS §5.2).
 */
@Entity
@Table(name = "media_consents")
@Getter
@Setter
public class MediaConsent {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "root_asset_id", nullable = false)
    private UUID rootAssetId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "terms_version", nullable = false)
    private String termsVersion;

    @Column(name = "ip_address", length = 45)
    private String ipAddress;

    @Column(name = "consented_at", nullable = false)
    private Instant consentedAt;
}
