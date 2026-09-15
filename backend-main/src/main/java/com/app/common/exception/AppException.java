package com.app.common.exception;

import lombok.Getter;

/**
 * Exception nghiệp vụ dùng chung cho toàn app — ném bằng {@code new AppException(ErrorCode.XXX)}.
 * Không tạo exception class riêng theo module trừ khi thực sự cần mang thêm dữ liệu/logic khác nhau.
 */
@Getter
public class AppException extends RuntimeException {

    private final ErrorCode errorCode;

    public AppException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}
