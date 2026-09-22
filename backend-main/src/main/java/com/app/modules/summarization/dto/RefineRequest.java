package com.app.modules.summarization.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotBlank;

/** {@code POST .../refine} body (API_Contract.md §5.1). */
public record RefineRequest(
        @NotBlank
        @JsonAlias("feedback")
        String feedbackText
) {
}
