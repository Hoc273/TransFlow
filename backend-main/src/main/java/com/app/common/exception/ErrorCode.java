package com.app.common.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * Mã lỗi tập trung cho toàn bộ {@code backend-main} — xem API_Contract.md §15.
 *
 * <p>Dải mã theo module (100 mã/module, đúng thứ tự bảng module ở CLAUDE.md §4.8):
 * auth 2000-2099, workspace 2100-2199, project 2200-2299, credit 2300-2399,
 * provider 2400-2499, preset 2500-2599, notification 2600-2699, dashboard 2700-2799,
 * media_asset 2800-2899, media_job 2900-2999, summarization 3000-3099, batch 3100-3199,
 * glossary 3200-3299, qa 3300-3399. Chỉ thêm mã mới trong đúng dải của module mình phụ trách,
 * đồng thời cập nhật bảng API_Contract.md §15.3.
 */
@Getter
public enum ErrorCode {

    // 1xxx - thành công
    SUCCESS(1000, "Success", HttpStatus.OK),

    // 9xxx - lỗi hệ thống / dùng chung, không gắn module cụ thể
    UNCATEGORIZED_EXCEPTION(9999, "Internal server error", HttpStatus.INTERNAL_SERVER_ERROR),
    VALIDATION_ERROR(9998, "Validation failed", HttpStatus.BAD_REQUEST),
    UNAUTHENTICATED(9997, "Authentication required", HttpStatus.UNAUTHORIZED),
    UNAUTHORIZED(9996, "Access denied", HttpStatus.FORBIDDEN),
    RESOURCE_NOT_FOUND(9995, "Resource not found", HttpStatus.NOT_FOUND),

    // 23xx - credit (Member A)
    INSUFFICIENT_CREDIT(2300, "Insufficient credit balance", HttpStatus.PAYMENT_REQUIRED),

    // 28xx - media_asset (Member B)
    TERMS_NOT_ACCEPTED(2800, "Current terms version has not been accepted for this asset", HttpStatus.FORBIDDEN),

    // 29xx - media_job (Member B)
    VOICE_LANGUAGE_MISMATCH(2900, "Selected voice language does not match targetLang", HttpStatus.BAD_REQUEST),
    JOB_OWNERSHIP_REQUIRED(2901, "Only the job creator or a workspace Lead may perform this action", HttpStatus.FORBIDDEN),
    STAGE_NOT_READY(2902, "Preceding stages are not COMPLETED/SKIPPED yet", HttpStatus.CONFLICT),

    // 30xx - summarization (Member B)
    REFINE_LIMIT_REACHED(3000, "Maximum of 5 refine iterations per session reached", HttpStatus.TOO_MANY_REQUESTS),

    // 31xx - batch (Member B)
    BATCH_SIZE_EXCEEDED(3100, "sourceAssetIds must contain between 1 and 20 items", HttpStatus.BAD_REQUEST),

    // 33xx - qa (Member B)
    QA_BLOCKED(3300, "Blocking QA issues must be resolved or overridden first", HttpStatus.FORBIDDEN),
    OVERRIDE_NOT_ALLOWED(3301, "This issue type can never be overridden", HttpStatus.FORBIDDEN),
    ;

    private final Integer code;
    private final String message;
    private final HttpStatus httpStatusCode;

    ErrorCode(Integer code, String message, HttpStatus httpStatusCode) {
        this.code = code;
        this.message = message;
        this.httpStatusCode = httpStatusCode;
    }
}
