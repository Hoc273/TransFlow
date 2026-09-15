package com.app.modules.auth.dto;

import com.app.modules.auth.entity.User;

import java.util.UUID;

/**
 * Public user shape for auth responses and {@code GET /api/auth/me}
 * as defined in API_Contract.md §1.
 */
public record UserResponse(
        UUID id,
        String email,
        String fullName,
        boolean googleLinked
) {
    public static UserResponse from(User u) {
        return new UserResponse(
                u.getId(),
                u.getEmail(),
                u.getFullName(),
                u.isGoogleLinked()
        );
    }
}
