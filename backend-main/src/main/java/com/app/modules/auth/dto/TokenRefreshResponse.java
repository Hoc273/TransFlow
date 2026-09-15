package com.app.modules.auth.dto;

/**
 * Response for {@code POST /api/auth/refresh} conforming to API_Contract.md §1.
 */
public record TokenRefreshResponse(
        String accessToken,
        String refreshToken
) {
}
