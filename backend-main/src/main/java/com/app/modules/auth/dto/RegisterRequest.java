package com.app.modules.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @NotBlank @Email @Size(max = 320) String email,
        @NotBlank @Size(min = 8, max = 72) String password,
        @NotBlank @Size(max = 200) String fullName,
        @Size(max = 6) String otp
) {
    public RegisterRequest(String email, String password, String fullName) {
        this(email, password, fullName, null);
    }
}
