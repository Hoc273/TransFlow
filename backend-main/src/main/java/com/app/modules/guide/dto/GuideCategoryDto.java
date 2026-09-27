package com.app.modules.guide.dto;

import com.app.modules.guide.entity.GuideCategory;

import java.time.Instant;
import java.util.UUID;

public record GuideCategoryDto(
        UUID id,
        String slug,
        String title,
        String titleVi,
        String titleEn,
        int orderIndex,
        boolean published,
        long articleCount,
        Instant createdAt,
        Instant updatedAt
) {
    public static GuideCategoryDto of(GuideCategory c, String lang, long articleCount) {
        String title = "en".equalsIgnoreCase(lang) && c.getTitleEn() != null && !c.getTitleEn().isBlank()
                ? c.getTitleEn()
                : c.getTitleVi();
        return new GuideCategoryDto(
                c.getId(),
                c.getSlug(),
                title,
                c.getTitleVi(),
                c.getTitleEn(),
                c.getOrderIndex(),
                c.isPublished(),
                articleCount,
                c.getCreatedAt(),
                c.getUpdatedAt()
        );
    }
}
