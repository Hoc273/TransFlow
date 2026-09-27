package com.app.modules.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;

import java.util.UUID;

/**
 * Standard Auth response returned by register, login, and google/exchange.
 * Conforms to API_Contract.md §1:
 * {accessToken, user, workspaceId, projectId}. The refresh token travels only in the
 * HttpOnly refresh cookie (AuthCookieService) — never in JSON, so XSS cannot read it.
 */
public record AuthResponse(
        String accessToken,
        @JsonIgnore String refreshToken,
        UserResponse user,
        UUID workspaceId,
        UUID projectId
) {
}
