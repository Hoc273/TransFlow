package com.app.modules.guide.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/** Terms of Service / Privacy Policy — one row per type, edited by Platform Super Admin. */
@Entity
@Table(name = "legal_documents")
@Getter
@Setter
@NoArgsConstructor
public class LegalDocument {

    @Id
    @Enumerated(EnumType.STRING)
    @Column(name = "doc_type", nullable = false, updatable = false, length = 20)
    private LegalDocumentType docType;

    @Column(name = "title_vi", nullable = false, length = 300)
    private String titleVi;

    @Column(name = "title_en", nullable = false, length = 300)
    private String titleEn;

    @Column(name = "content_vi", nullable = false, columnDefinition = "TEXT")
    private String contentVi;

    @Column(name = "content_en", nullable = false, columnDefinition = "TEXT")
    private String contentEn;

    @Column(name = "updated_by")
    private UUID updatedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
