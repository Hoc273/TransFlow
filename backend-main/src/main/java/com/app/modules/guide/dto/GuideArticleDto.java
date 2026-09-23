package com.app.modules.guide.dto;

import com.app.modules.guide.entity.GuideArticle;
import com.app.modules.guide.entity.GuideArticleStatus;

import java.time.Instant;
import java.util.UUID;

public record GuideArticleDto(
        UUID id,
        UUID categoryId,
        String categorySlug,
        String categoryTitle,
        String slug,
        String title,
        String titleVi,
        String titleEn,
        String excerpt,
        String excerptVi,
        String excerptEn,
        String content,
        String contentVi,
        String contentEn,
        GuideArticleStatus status,
        int orderIndex,
        String coverImageUrl,
        Instant createdAt,
        Instant updatedAt
) {
    public static GuideArticleDto of(GuideArticle a, String lang) {
        boolean isEn = "en".equalsIgnoreCase(lang);
        String title = isEn && a.getTitleEn() != null && !a.getTitleEn().isBlank() ? a.getTitleEn() : a.getTitleVi();
        String excerpt = isEn && a.getExcerptEn() != null && !a.getExcerptEn().isBlank() ? a.getExcerptEn() : a.getExcerptVi();
        String content = isEn && a.getContentEn() != null && !a.getContentEn().isBlank() ? a.getContentEn() : a.getContentVi();

        String catTitle = null;
        String catSlug = null;
        UUID catId = null;
        if (a.getCategory() != null) {
            catId = a.getCategory().getId();
            catSlug = a.getCategory().getSlug();
            catTitle = isEn && a.getCategory().getTitleEn() != null ? a.getCategory().getTitleEn() : a.getCategory().getTitleVi();
        }

        return new GuideArticleDto(
                a.getId(),
                catId,
                catSlug,
                catTitle,
                a.getSlug(),
                title,
                a.getTitleVi(),
                a.getTitleEn(),
                excerpt,
                a.getExcerptVi(),
                a.getExcerptEn(),
                content,
                a.getContentVi(),
                a.getContentEn(),
                a.getStatus(),
                a.getOrderIndex(),
                a.getCoverImageUrl(),
                a.getCreatedAt(),
                a.getUpdatedAt()
        );
    }
}
