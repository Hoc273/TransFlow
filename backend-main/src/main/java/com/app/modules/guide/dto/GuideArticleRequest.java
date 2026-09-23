package com.app.modules.guide.dto;

import com.app.modules.guide.entity.GuideArticleStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record GuideArticleRequest(
        @Pattern(regexp = "^[a-z0-9-]+$", message = "Slug must contain only lowercase letters, numbers, and hyphens")
        @Size(max = 160)
        String slug,

        @NotNull(message = "categoryId is required")
        UUID categoryId,

        @NotBlank(message = "titleVi is required")
        @Size(max = 300)
        String titleVi,

        @NotBlank(message = "titleEn is required")
        @Size(max = 300)
        String titleEn,

        @Size(max = 500)
        String excerptVi,

        @Size(max = 500)
        String excerptEn,

        @NotBlank(message = "contentVi is required")
        @Size(max = 100000, message = "contentVi cannot exceed 100000 characters")
        String contentVi,

        @NotBlank(message = "contentEn is required")
        @Size(max = 100000, message = "contentEn cannot exceed 100000 characters")
        String contentEn,

        Integer orderIndex,

        @Size(max = 1000)
        String coverImageUrl,

        GuideArticleStatus status
) {}
