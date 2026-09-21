package com.app.modules.auth.service.email;

public enum OtpType {
    REGISTER("Xác thực tạo tài khoản mới"),
    FORGOT_PASSWORD("Yêu cầu đặt lại mật khẩu");

    private final String description;

    OtpType(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
}
