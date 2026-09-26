package com.app.modules.glossary.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** {@code POST/PUT .../glossary/terms[/{termId}]} body (API_Contract.md §7). */
public record GlossaryTermRequest(
        @NotBlank @Size(max = 500) String sourceTerm,
        @NotBlank @Size(max = 500) String targetTerm,
        @NotBlank @Size(max = 16) String targetLang
) {
}
