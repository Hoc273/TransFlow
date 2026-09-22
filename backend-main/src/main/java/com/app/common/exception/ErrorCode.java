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

    // 20xx - auth (Member A)
    EMAIL_ALREADY_EXISTS(2000, "Email is already registered", HttpStatus.CONFLICT),
    INVALID_CREDENTIALS(2001, "Invalid email or password", HttpStatus.UNAUTHORIZED),
    ACCOUNT_DISABLED(2002, "Account is disabled", HttpStatus.FORBIDDEN),
    OAUTH_ONLY_ACCOUNT(2003, "This account signs in with Google. Use Continue with Google, or set a password in Settings.", HttpStatus.UNAUTHORIZED),
    INVALID_REFRESH_TOKEN(2004, "Invalid or expired refresh token", HttpStatus.UNAUTHORIZED),
    USER_NOT_FOUND(2005, "User no longer exists", HttpStatus.UNAUTHORIZED),
    GOOGLE_OAUTH_FAILED(2006, "Google sign-in failed", HttpStatus.UNAUTHORIZED),
    GOOGLE_EMAIL_UNVERIFIED(2007, "Google email is not verified", HttpStatus.BAD_REQUEST),
    GOOGLE_ACCOUNT_CONFLICT(2008, "Google account conflict", HttpStatus.CONFLICT),
    GOOGLE_NOT_CONFIGURED(2009, "Google sign-in is not configured on this environment", HttpStatus.BAD_REQUEST),
    GOOGLE_STATE_INVALID(2010, "Google OAuth state invalid", HttpStatus.BAD_REQUEST),

    // 21xx - workspace (Member A)
    WORKSPACE_NOT_FOUND(2100, "Workspace not found", HttpStatus.NOT_FOUND),
    WORKSPACE_MEMBER_NOT_FOUND(2101, "Workspace member not found", HttpStatus.NOT_FOUND),
    LEAD_CANNOT_BE_REMOVED(2102, "Workspace Lead cannot be removed or demoted", HttpStatus.BAD_REQUEST),
    WORKSPACE_MEMBER_ALREADY_EXISTS(2103, "User is already a member of this workspace", HttpStatus.CONFLICT),
    CANNOT_ASSIGN_LEAD_ROLE(2104, "Cannot invite or change role to Lead", HttpStatus.BAD_REQUEST),
    WORKSPACE_SLUG_ALREADY_EXISTS(2105, "Workspace slug already exists", HttpStatus.CONFLICT),

    // 22xx - project (Member A)
    PROJECT_NOT_FOUND(2200, "Project not found", HttpStatus.NOT_FOUND),
    PROJECT_MEMBER_NOT_FOUND(2201, "Project member not found", HttpStatus.NOT_FOUND),
    PROJECT_ACCESS_DENIED(2202, "Project access denied", HttpStatus.FORBIDDEN),
    USER_NOT_WORKSPACE_MEMBER(2203, "User must be a workspace member before being assigned to a project", HttpStatus.BAD_REQUEST),
    LEAD_ALREADY_HAS_FULL_PROJECT_ACCESS(2204, "Workspace Lead already has full access to all projects and cannot be assigned", HttpStatus.BAD_REQUEST),
    PROJECT_MEMBER_ALREADY_EXISTS(2205, "User is already assigned to this project", HttpStatus.CONFLICT),

    // 23xx - credit (Member A)
    INSUFFICIENT_CREDIT(2300, "Insufficient credit balance", HttpStatus.PAYMENT_REQUIRED),
    CREDIT_PACKAGE_NOT_FOUND(2301, "Credit package not found", HttpStatus.NOT_FOUND),
    CREDIT_PACKAGE_INACTIVE(2302, "Credit package is not active", HttpStatus.BAD_REQUEST),
    CREDIT_ACCOUNT_NOT_FOUND(2303, "Credit account not found", HttpStatus.NOT_FOUND),

    // 24xx - provider (Member A)
    PROVIDER_NOT_FOUND(2400, "AI provider not found", HttpStatus.NOT_FOUND),
    PROVIDER_CAPABILITY_NOT_SUPPORTED(2401, "AI provider does not support this capability", HttpStatus.BAD_REQUEST),
    PROVIDER_TEST_FAILED(2402, "AI provider connection test failed", HttpStatus.BAD_REQUEST),
    PROVIDER_VOICES_FETCH_FAILED(2403, "Failed to fetch voices from AI provider", HttpStatus.BAD_GATEWAY),
    PLATFORM_PROVIDER_NOT_CONFIGURED(2404, "No platform AI provider configured for this capability", HttpStatus.BAD_REQUEST),
    INVALID_PROVIDER_PROTOCOL(2405, "Unsupported AI provider protocol", HttpStatus.BAD_REQUEST),
    TTS_VOICE_NOT_FOUND(2406, "TTS voice not found", HttpStatus.NOT_FOUND),
    TTS_PREVIEW_RATE_LIMIT_EXCEEDED(2407, "Too many voice preview requests; please try again later", HttpStatus.TOO_MANY_REQUESTS),
    TTS_PREVIEW_FAILED(2408, "TTS provider did not return preview audio", HttpStatus.BAD_GATEWAY),

    // 25xx - preset (Member A)
    PRESET_NOT_FOUND(2500, "Media preset not found", HttpStatus.NOT_FOUND),
    PRESET_INACTIVE(2501, "Media preset is inactive", HttpStatus.BAD_REQUEST),
    PRESET_SCOPE_INVALID(2502, "Invalid preset scope or scope ownership constraint violated", HttpStatus.BAD_REQUEST),
    CANNOT_DELETE_ONLY_DEFAULT_PRESET(2503, "Cannot delete the default preset in this scope without designating a replacement", HttpStatus.BAD_REQUEST),
    SYSTEM_PRESET_READ_ONLY(2504, "System presets are managed by the platform and cannot be modified or deleted", HttpStatus.FORBIDDEN),
    PRESET_DEFAULT_CONFLICT(2505, "A default preset already exists in this scope", HttpStatus.CONFLICT),
    REPLACEMENT_PRESET_INVALID(2506, "Replacement preset must exist, be active, and belong to the same scope", HttpStatus.BAD_REQUEST),

    // 26xx - notification (Member A)
    NOTIFICATION_NOT_FOUND(2600, "Notification not found", HttpStatus.NOT_FOUND),
    NOTIFICATION_TYPE_INVALID(2601, "Invalid notification type", HttpStatus.BAD_REQUEST),

    // 27xx - dashboard (Member A)
    DASHBOARD_DATE_RANGE_INVALID(2700, "Invalid date range: 'from' must be before or equal to 'to'", HttpStatus.BAD_REQUEST),
    DASHBOARD_GROUP_BY_INVALID(2701, "Invalid groupBy parameter; supported values are 'project', 'user', 'operation'", HttpStatus.BAD_REQUEST),

    // 28xx - media_asset (Member B)
    TERMS_NOT_ACCEPTED(2800, "Current terms version has not been accepted for this asset", HttpStatus.FORBIDDEN),
    MEDIA_FILE_TOO_LARGE(2801, "Uploaded file exceeds the maximum allowed size of 500MB", HttpStatus.BAD_REQUEST),
    MEDIA_DURATION_EXCEEDED(2802, "Video duration exceeds the maximum allowed length of 30 minutes", HttpStatus.BAD_REQUEST),
    TERMS_VERSION_MISMATCH(2803, "termsVersion does not match the current terms version", HttpStatus.BAD_REQUEST),

    // 29xx - media_job (Member B)
    VOICE_LANGUAGE_MISMATCH(2900, "Selected voice language does not match targetLang", HttpStatus.BAD_REQUEST),
    JOB_OWNERSHIP_REQUIRED(2901, "Only the job creator or a workspace Lead may perform this action", HttpStatus.FORBIDDEN),
    STAGE_NOT_READY(2902, "Preceding stages are not COMPLETED/SKIPPED yet", HttpStatus.CONFLICT),

    // 30xx - summarization (Member B)
    REFINE_LIMIT_REACHED(3000, "Maximum of 5 refine iterations per session reached", HttpStatus.TOO_MANY_REQUESTS),
    PROPOSAL_ALREADY_TRANSLATED(3001, "This proposal has already been used to create a translation; rerun TRANSLATE before changing it", HttpStatus.CONFLICT),

    // 31xx - batch (Member B)
    BATCH_SIZE_EXCEEDED(3100, "sourceAssetIds must contain between 1 and 20 items", HttpStatus.BAD_REQUEST),
    BATCH_RATE_LIMIT_EXCEEDED(3101, "Too many batches created recently; please wait before creating another", HttpStatus.TOO_MANY_REQUESTS),

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
