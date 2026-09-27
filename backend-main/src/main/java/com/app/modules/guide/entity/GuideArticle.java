package com.app.modules.guide.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.UUID;

/** Guide article = one Markdown doc (vi/en), owned by a category. */
@Entity
@Table(name = "guide_articles")
@Getter
@Setter
@NoArgsConstructor
public class GuideArticle {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "category_id", nullable = false)
    private GuideCategory category;

    @Column(nullable = false, unique = true, length = 160)
    private String slug;

    @Column(name = "title_vi", nullable = false, length = 300)
    private String titleVi;

    @Column(name = "title_en", nullable = false, length = 300)
    private String titleEn;

    @Column(name = "excerpt_vi", length = 500)
    private String excerptVi;

    @Column(name = "excerpt_en", length = 500)
    private String excerptEn;

    @Column(name = "content_vi", nullable = false, columnDefinition = "TEXT")
    private String contentVi;

    @Column(name = "content_en", nullable = false, columnDefinition = "TEXT")
    private String contentEn;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private GuideArticleStatus status = GuideArticleStatus.DRAFT;

    @Column(name = "order_index", nullable = false)
    private int orderIndex = 0;

    @Column(name = "cover_image_url", length = 1000)
    private String coverImageUrl;

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
