package com.app.modules.auth.dto;

import java.util.UUID;

/**
 * Standard Auth response returned by register, login, and google/exchange.
 * Conforms to API_Contract.md §1:
 * {accessToken, refreshToken, user, workspaceId, projectId}
 */
public record AuthResponse(
        String accessToken,
        String refreshToken,
        UserResponse user,
        UUID workspaceId,
        UUID projectId
) {
}
