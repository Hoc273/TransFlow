package com.app.modules.glossary.dto;

import jakarta.validation.constraints.NotBlank;

/** {@code POST/PUT .../glossary/terms[/{termId}]} body (API_Contract.md §7). */
public record GlossaryTermRequest(
        @NotBlank String sourceTerm,
        @NotBlank String targetTerm,
        @NotBlank String targetLang
) {
}
