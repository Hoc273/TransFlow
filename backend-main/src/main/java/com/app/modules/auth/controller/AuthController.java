package com.app.modules.auth.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.auth.dto.*;
import com.app.modules.auth.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * Authentication endpoints (API_Contract.md §1 & docs/api-response-convention.md).
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<AuthResponse> register(@Valid @RequestBody RegisterRequest req) {
        return ApiResponse.<AuthResponse>builder()
                .data(authService.register(req))
                .build();
    }

    @PostMapping("/register/otp")
    public ApiResponse<OtpMessageResponse> sendRegisterOtp(@Valid @RequestBody RegisterOtpRequest req) {
        return ApiResponse.<OtpMessageResponse>builder()
                .data(authService.sendRegisterOtp(req))
                .build();
    }

    @PostMapping("/login")
    public ApiResponse<AuthResponse> login(@Valid @RequestBody LoginRequest req) {
        return ApiResponse.<AuthResponse>builder()
                .data(authService.login(req))
                .build();
    }

    @PostMapping("/refresh")
    public ApiResponse<TokenRefreshResponse> refresh(@Valid @RequestBody RefreshRequest req) {
        return ApiResponse.<TokenRefreshResponse>builder()
                .data(authService.refresh(req))
                .build();
    }

    @GetMapping("/me")
    public ApiResponse<UserResponse> me(@AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<UserResponse>builder()
                .data(authService.me(user.id()))
                .build();
    }

    @PutMapping("/me")
    public ApiResponse<UserResponse> updateProfile(@AuthenticationPrincipal AuthenticatedUser user,
                                                   @Valid @RequestBody UpdateProfileRequest req) {
        return ApiResponse.<UserResponse>builder()
                .data(authService.updateProfile(user.id(), req))
                .build();
    }

    @PutMapping("/password")
    public ApiResponse<Void> changePassword(@AuthenticationPrincipal AuthenticatedUser user,
                                            @Valid @RequestBody ChangePasswordRequest req) {
        authService.changePassword(user.id(), req);
        return ApiResponse.<Void>builder().build();
    }

    @PostMapping("/forgot-password/otp")
    public ApiResponse<OtpMessageResponse> sendForgotPasswordOtp(@Valid @RequestBody ForgotPasswordOtpRequest req) {
        return ApiResponse.<OtpMessageResponse>builder()
                .data(authService.sendForgotPasswordOtp(req))
                .build();
    }

    @PostMapping("/forgot-password/verify")
    public ApiResponse<OtpVerifyResponse> verifyForgotPasswordOtp(@Valid @RequestBody VerifyPasswordOtpRequest req) {
        return ApiResponse.<OtpVerifyResponse>builder()
                .data(authService.verifyForgotPasswordOtp(req))
                .build();
    }

    @PostMapping("/forgot-password/reset")
    public ApiResponse<OtpMessageResponse> resetPasswordWithOtp(@Valid @RequestBody ResetPasswordOtpRequest req) {
        return ApiResponse.<OtpMessageResponse>builder()
                .data(authService.resetPasswordWithOtp(req))
                .build();
    }
}
