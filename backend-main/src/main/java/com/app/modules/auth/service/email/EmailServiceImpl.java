package com.app.modules.auth.service.email;

import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;

@Slf4j
@Service
public class EmailServiceImpl implements EmailService {

    private final JavaMailSender mailSender;

    @Value("${spring.mail.username:}")
    private String mailUsername;

    @Value("${spring.mail.from:no-reply@transflow.vn}")
    private String mailFrom;

    public EmailServiceImpl(@Autowired(required = false) JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    @Override
    public void sendOtpEmail(String toEmail, String otp, OtpType type) {
        if (isMailDisabled()) {
            log.warn("[EMAIL LOCAL FALLBACK] Mail credentials not configured. OTP for {} ({}): [{}]",
                    toEmail, type.getDescription(), otp);
            return;
        }

        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, MimeMessageHelper.MULTIPART_MODE_MIXED_RELATED, StandardCharsets.UTF_8.name());

            String senderAddress = (mailUsername != null && !mailUsername.isBlank()) ? mailUsername : mailFrom;
            helper.setFrom(new InternetAddress(senderAddress, "TransFlow Media", "UTF-8"));
            helper.setTo(toEmail);
            helper.setSubject("[TransFlow] Mã xác thực OTP: " + otp + " (" + type.getDescription() + ")");

            String htmlBody = buildOtpTemplate(otp, type);
            helper.setText(htmlBody, true);

            mailSender.send(message);
            log.info("[EMAIL SENT] Successfully sent OTP email to {} for {}", toEmail, type.name());
        } catch (Exception e) {
            log.error("[EMAIL ERROR] Failed to send OTP email to {}: {}. OTP fallback: [{}]",
                    toEmail, e.getMessage(), otp, e);
        }
    }

    private boolean isMailDisabled() {
        return mailSender == null
                || mailUsername == null
                || mailUsername.isBlank()
                || mailUsername.contains("your-email@gmail.com")
                || mailUsername.equals("test");
    }

    private String buildOtpTemplate(String otp, OtpType type) {
        return "<!DOCTYPE html>"
                + "<html>"
                + "<head><meta charset=\"utf-8\"><title>Mã xác thực TransFlow</title></head>"
                + "<body style=\"margin: 0; padding: 24px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;\">"
                + "  <table align=\"center\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"max-width: 520px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;\">"
                + "    <tr>"
                + "      <td style=\"padding: 28px 32px; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); text-align: center;\">"
                + "        <h1 style=\"margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;\">TransFlow</h1>"
                + "        <p style=\"margin: 6px 0 0 0; color: #e0e7ff; font-size: 13px;\">Hệ thống Quản lý Dự án & Tài nguyên Đa phương tiện</p>"
                + "      </td>"
                + "    </tr>"
                + "    <tr>"
                + "      <td style=\"padding: 32px;\">"
                + "        <h2 style=\"margin: 0 0 12px 0; color: #1e293b; font-size: 18px; font-weight: 600;\">Xác thực mã OTP</h2>"
                + "        <p style=\"margin: 0 0 20px 0; color: #475569; font-size: 14px; line-height: 1.6;\">"
                + "          Bạn đang thực hiện thao tác: <strong style=\"color: #0f172a;\">" + type.getDescription() + "</strong>.<br/>"
                + "          Vui lòng sử dụng mã OTP dưới đây để hoàn tất xác thực tài khoản:"
                + "        </p>"
                + "        <div style=\"background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;\">"
                + "          <span style=\"font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; font-family: monospace;\">" + otp + "</span>"
                + "        </div>"
                + "        <p style=\"margin: 0 0 8px 0; color: #64748b; font-size: 13px; line-height: 1.5;\">"
                + "          ⏱ Mã OTP có hiệu lực trong vòng <strong>5 phút</strong>."
                + "        </p>"
                + "        <p style=\"margin: 0; color: #ef4444; font-size: 12px; line-height: 1.5;\">"
                + "          ⚠️ Tuyệt đối không chia sẻ mã này cho bất kỳ ai khác để bảo vệ an toàn tài khoản của bạn."
                + "        </p>"
                + "      </td>"
                + "    </tr>"
                + "    <tr>"
                + "      <td style=\"padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;\">"
                + "        <p style=\"margin: 0; color: #94a3b8; font-size: 12px;\">"
                + "          Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email hoặc liên hệ hỗ trợ."
                + "        </p>"
                + "        <p style=\"margin: 6px 0 0 0; color: #94a3b8; font-size: 11px;\">"
                + "          &copy; TransFlow Media Platform. All rights reserved."
                + "        </p>"
                + "      </td>"
                + "    </tr>"
                + "  </table>"
                + "</body>"
                + "</html>";
    }
}
