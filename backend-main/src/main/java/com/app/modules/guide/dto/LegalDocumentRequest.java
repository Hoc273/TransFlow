package com.app.modules.guide.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LegalDocumentRequest(
        @NotBlank(message = "titleVi is required")
        @Size(max = 300)
        String titleVi,

        @NotBlank(message = "titleEn is required")
        @Size(max = 300)
        String titleEn,

        @NotBlank(message = "contentVi is required")
        String contentVi,

        @NotBlank(message = "contentEn is required")
        String contentEn
) {}
