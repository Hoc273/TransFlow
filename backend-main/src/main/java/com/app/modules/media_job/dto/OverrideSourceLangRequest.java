package com.app.modules.media_job.dto;

import jakarta.validation.constraints.NotBlank;

/** {@code POST .../override-source-lang} body (API_Contract.md §5); validated against the configured language list. */
public record OverrideSourceLangRequest(@NotBlank String sourceLang) {
}
