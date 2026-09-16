package com.app.modules.qa.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** {@code POST .../qa-issues/{issueId}/override} body (API_Contract.md §8) — reason must be >= 10 chars. */
public record OverrideRequest(@NotBlank @Size(min = 10) String reason) {
}
