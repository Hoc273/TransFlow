package com.app.modules.auth.dto;

import com.app.modules.auth.entity.User;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * Public user shape for auth responses and {@code GET /api/auth/me}
 * as defined in API_Contract.md §1.
 */
public record UserResponse(
        UUID id,
        String email,
        String fullName,
        boolean googleLinked,
        @JsonProperty("isPlatformAdmin") boolean isPlatformAdmin
) {
    public UserResponse(UUID id, String email, String fullName, boolean googleLinked) {
        this(id, email, fullName, googleLinked, false);
    }

    public static UserResponse from(User u) {
        return new UserResponse(
                u.getId(),
                u.getEmail(),
                u.getFullName(),
                u.isGoogleLinked(),
                u.isPlatformAdmin()
        );
    }
}
