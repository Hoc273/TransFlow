package com.app.modules.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * Response for {@code POST /api/auth/refresh} conforming to API_Contract.md §1.
 * The rotated refresh token is set as the HttpOnly cookie, not serialized.
 */
public record TokenRefreshResponse(
        String accessToken,
        @JsonIgnore String refreshToken
) {
}
