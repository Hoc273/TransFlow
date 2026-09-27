package com.app.modules.auth.dto;

import jakarta.validation.constraints.Size;

/** Body is optional: browsers send the refresh token via the HttpOnly cookie instead. */

public record RefreshRequest(
        @Size(max = 4096) String refreshToken
) {
}
