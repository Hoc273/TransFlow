package com.app.modules.auth.dto;

public record OtpVerifyResponse(
        boolean valid,
        String token
) {
}
