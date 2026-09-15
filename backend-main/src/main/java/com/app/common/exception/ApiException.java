package com.app.common.exception;

import org.springframework.http.HttpStatus;

import java.util.Map;

public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final Map<String, String> details;

    public ApiException(HttpStatus status, String message) {
        this(status, message, null, null);
    }

    public ApiException(HttpStatus status, String message, String code) {
        this(status, message, code, null);
    }

    public ApiException(HttpStatus status, String message, String code, Map<String, String> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public Map<String, String> getDetails() {
        return details;
    }

    public static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, message);
    }

    public static ApiException badRequest(String message, String code) {
        return new ApiException(HttpStatus.BAD_REQUEST, message, code);
    }

    public static ApiException badRequest(String message, String code, Map<String, String> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, message, code, details);
    }

    public static ApiException unauthorized(String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, message);
    }

    public static ApiException forbidden(String message) {
        return new ApiException(HttpStatus.FORBIDDEN, message);
    }

    public static ApiException forbidden(String message, String code) {
        return new ApiException(HttpStatus.FORBIDDEN, message, code);
    }

    public static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, message);
    }

    public static ApiException conflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, message);
    }

    public static ApiException conflict(String message, String code) {
        return new ApiException(HttpStatus.CONFLICT, message, code);
    }
}
