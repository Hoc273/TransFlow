package com.app.modules.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateProfileRequest(
        @NotBlank(message = "Full name is required")
        @Size(max = 200, message = "Full name must be at most 200 characters")
        String fullName,

        @Size(max = 1_500_000, message = "Avatar is too large")
        String avatarUrl
) {
    public UpdateProfileRequest(String fullName) {
        this(fullName, null);
    }
}
