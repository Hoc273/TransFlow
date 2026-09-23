package com.app.modules.guide.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record GuideCategoryRequest(
        @Pattern(regexp = "^[a-z0-9-]+$", message = "Slug must contain only lowercase letters, numbers, and hyphens")
        @Size(max = 120)
        String slug,

        @NotBlank(message = "titleVi is required")
        @Size(max = 200)
        String titleVi,

        @NotBlank(message = "titleEn is required")
        @Size(max = 200)
        String titleEn,

        Integer orderIndex,
        Boolean published
) {}
