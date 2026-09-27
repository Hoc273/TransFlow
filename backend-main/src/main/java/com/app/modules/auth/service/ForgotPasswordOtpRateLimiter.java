package com.app.modules.auth.service;

/**
 * Fixed-window rate limit for forgot-password OTP requests, keyed by email.
 * Throws {@link com.app.common.exception.AppException} with
 * {@link com.app.common.exception.ErrorCode#OTP_RATE_LIMIT_EXCEEDED} when exceeded.
 */
public interface ForgotPasswordOtpRateLimiter {

    void check(String email);
}
