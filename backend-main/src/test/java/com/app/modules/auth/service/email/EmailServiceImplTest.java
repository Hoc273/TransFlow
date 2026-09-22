package com.app.modules.auth.service.email;

import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class EmailServiceImplTest {

    @Mock
    private JavaMailSender mailSender;

    @Test
    void testSendOtpEmail_WhenMailDisabled_ShouldNotSend() {
        EmailServiceImpl emailService = new EmailServiceImpl(mailSender);
        ReflectionTestUtils.setField(emailService, "mailUsername", "");

        emailService.sendOtpEmail("user@example.com", "123456", OtpType.REGISTER);

        verifyNoInteractions(mailSender);
    }

    @Test
    void testSendOtpEmail_WhenMailConfigured_ShouldCallSend() {
        MimeMessage mockMimeMessage = mock(MimeMessage.class);
        when(mailSender.createMimeMessage()).thenReturn(mockMimeMessage);

        EmailServiceImpl emailService = new EmailServiceImpl(mailSender);
        ReflectionTestUtils.setField(emailService, "mailUsername", "transflow.sender@gmail.com");
        ReflectionTestUtils.setField(emailService, "mailFrom", "transflow.sender@gmail.com");

        emailService.sendOtpEmail("recipient@example.com", "654321", OtpType.REGISTER);

        verify(mailSender, times(1)).send(mockMimeMessage);
    }

    @Test
    void testSendOtpEmail_WhenSendThrows_ShouldCatchGracefully() {
        MimeMessage mockMimeMessage = mock(MimeMessage.class);
        when(mailSender.createMimeMessage()).thenReturn(mockMimeMessage);
        doThrow(new RuntimeException("SMTP Connection failed")).when(mailSender).send(mockMimeMessage);

        EmailServiceImpl emailService = new EmailServiceImpl(mailSender);
        ReflectionTestUtils.setField(emailService, "mailUsername", "transflow.sender@gmail.com");

        // Should not throw exception
        emailService.sendOtpEmail("recipient@example.com", "654321", OtpType.FORGOT_PASSWORD);

        verify(mailSender, times(1)).send(mockMimeMessage);
    }

    @Test
    void testSendOtpEmail_WhenMailFromSet_ShouldPreferMailFrom() throws Exception {
        // SMTP relay (SES/SendGrid) uses an apikey-style username — From must come from MAIL_FROM.
        MimeMessage realMessage = new MimeMessage((Session) null);
        when(mailSender.createMimeMessage()).thenReturn(realMessage);

        EmailServiceImpl emailService = new EmailServiceImpl(mailSender);
        ReflectionTestUtils.setField(emailService, "mailUsername", "smtp-apikey");
        ReflectionTestUtils.setField(emailService, "mailFrom", "no-reply@transflow.vn");

        emailService.sendOtpEmail("recipient@example.com", "654321", OtpType.FORGOT_PASSWORD);

        assertEquals("no-reply@transflow.vn", ((InternetAddress) realMessage.getFrom()[0]).getAddress());
        verify(mailSender, times(1)).send(realMessage);
    }
}
