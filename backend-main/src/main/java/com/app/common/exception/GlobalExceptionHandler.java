package com.app.common.exception;

import com.app.common.dto.ApiResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Handler tập trung duy nhất cho toàn app — xem docs/api-response-convention.md.
 */
@Slf4j
@ControllerAdvice
public class GlobalExceptionHandler {

    // Bean Validation (@Valid) — trả lỗi theo từng field trong `data`
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiResponse<Map<String, String>>> handleValidation(MethodArgumentNotValidException e) {
        Map<String, String> errors = new LinkedHashMap<>();
        e.getBindingResult().getFieldErrors().forEach(fe ->
                errors.putIfAbsent(fe.getField(), fe.getDefaultMessage()));

        return ResponseEntity.status(ErrorCode.VALIDATION_ERROR.getHttpStatusCode()).body(
                ApiResponse.<Map<String, String>>builder()
                        .code(ErrorCode.VALIDATION_ERROR.getCode())
                        .data(errors)
                        .build());
    }

    // Path/query param không ép kiểu được (ví dụ enum path variable sai giá trị) — 400
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiResponse<?>> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        ErrorCode errorCode = ErrorCode.VALIDATION_ERROR;
        return ResponseEntity.status(errorCode.getHttpStatusCode()).body(
                ApiResponse.builder()
                        .code(errorCode.getCode())
                        .message(errorCode.getMessage())
                        .build());
    }

    // Header bắt buộc bị thiếu (ví dụ X-Signature/X-Timestamp của callback nội bộ §14) — 400
    @ExceptionHandler(MissingRequestHeaderException.class)
    ResponseEntity<ApiResponse<?>> handleMissingHeader(MissingRequestHeaderException e) {
        ErrorCode errorCode = ErrorCode.VALIDATION_ERROR;
        return ResponseEntity.status(errorCode.getHttpStatusCode()).body(
                ApiResponse.builder()
                        .code(errorCode.getCode())
                        .message(errorCode.getMessage())
                        .build());
    }

    // Lỗi nghiệp vụ — mọi module ném AppException đều rơi vào đây
    @ExceptionHandler(AppException.class)
    ResponseEntity<ApiResponse<?>> handleAppException(AppException e) {
        ErrorCode errorCode = e.getErrorCode();
        return ResponseEntity.status(errorCode.getHttpStatusCode()).body(
                ApiResponse.builder()
                        .code(errorCode.getCode())
                        .message(errorCode.getMessage())
                        .build());
    }

    // Spring Security — 403
    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiResponse<?>> handleAccessDenied(AccessDeniedException e) {
        ErrorCode errorCode = ErrorCode.UNAUTHORIZED;
        return ResponseEntity.status(errorCode.getHttpStatusCode()).body(
                ApiResponse.builder()
                        .code(errorCode.getCode())
                        .message(errorCode.getMessage())
                        .build());
    }

    // Fallback — bắt mọi lỗi không lường trước, không lộ stacktrace/message gốc ra client
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponse<?>> handleException(Exception e) {
        log.error("Unhandled exception", e);
        ErrorCode errorCode = ErrorCode.UNCATEGORIZED_EXCEPTION;
        return ResponseEntity.status(errorCode.getHttpStatusCode()).body(
                ApiResponse.builder()
                        .code(errorCode.getCode())
                        .message(errorCode.getMessage())
                        .build());
    }
}
