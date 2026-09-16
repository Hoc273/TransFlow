package com.app.modules.summarization.dto;

import jakarta.validation.constraints.NotBlank;

/** {@code POST .../refine} body (API_Contract.md §5.1). */
public record RefineRequest(@NotBlank String feedbackText) {
}
