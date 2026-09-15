package com.app.common.exception;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.Map;

/**
 * Uniform error response envelope adhering to API_Contract.md §0.
 *
 * Example:
 * {
 *   "status": 400,
 *   "error": "Bad Request",
 *   "message": "Validation failed",
 *   "path": "/api/auth/register",
 *   "code": "EMAIL_ALREADY_EXISTS",
 *   "details": { "email": "must be a well-formed email address" }
 * }
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(
        Instant timestamp,
        int status,
        String error,
        String message,
        String path,
        String code,
        Map<String, String> details
) {
    public static ApiError of(int status, String error, String message, String path) {
        return new ApiError(Instant.now(), status, error, message, path, null, null);
    }

    public static ApiError of(int status, String error, String message, String path,
                              Map<String, String> details) {
        return new ApiError(Instant.now(), status, error, message, path, null, details);
    }

    public static ApiError of(int status, String error, String message, String path, String code) {
        return new ApiError(Instant.now(), status, error, message, path, code, null);
    }

    public static ApiError of(int status, String error, String message, String path,
                              String code, Map<String, String> details) {
        return new ApiError(Instant.now(), status, error, message, path, code, details);
    }
}
