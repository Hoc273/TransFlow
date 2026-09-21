package com.app.modules.auth.service.email;

public interface EmailService {
    /**
     * Gửi email mã xác thực OTP (Đăng ký hoặc Quên mật khẩu)
     *
     * @param toEmail Email người nhận
     * @param otp     Mã OTP 6 chữ số
     * @param type    Loại OTP (REGISTER hoặc FORGOT_PASSWORD)
     */
    void sendOtpEmail(String toEmail, String otp, OtpType type);
}
