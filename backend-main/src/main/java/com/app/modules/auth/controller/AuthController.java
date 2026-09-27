package com.app.modules.auth.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.auth.dto.*;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.service.AuthCookieService;
import com.app.modules.auth.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
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
    private final AuthCookieService authCookieService;

    public AuthController(AuthService authService, AuthCookieService authCookieService) {
        this.authService = authService;
        this.authCookieService = authCookieService;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<AuthResponse> register(@Valid @RequestBody RegisterRequest req, HttpServletResponse response) {
        AuthResponse auth = authService.register(req);
        authCookieService.writeRefreshCookie(response, auth.refreshToken());
        return ApiResponse.<AuthResponse>builder()
                .data(auth)
                .build();
    }

    @PostMapping("/register/otp")
    public ApiResponse<OtpMessageResponse> sendRegisterOtp(@Valid @RequestBody RegisterOtpRequest req) {
        return ApiResponse.<OtpMessageResponse>builder()
                .data(authService.sendRegisterOtp(req))
                .build();
    }

    @PostMapping("/login")
    public ApiResponse<AuthResponse> login(@Valid @RequestBody LoginRequest req, HttpServletResponse response) {
        AuthResponse auth = authService.login(req);
        authCookieService.writeRefreshCookie(response, auth.refreshToken());
        return ApiResponse.<AuthResponse>builder()
                .data(auth)
                .build();
    }

    /**
     * Rotates the refresh token. Browsers send it via the HttpOnly cookie; a JSON body
     * {@code {refreshToken}} is still accepted for non-browser clients.
     */
    @PostMapping("/refresh")
    public ApiResponse<TokenRefreshResponse> refresh(@Valid @RequestBody(required = false) RefreshRequest req,
                                                     HttpServletRequest request,
                                                     HttpServletResponse response) {
        String token = authCookieService.readRefreshCookie(request)
                .orElse(req != null ? req.refreshToken() : null);
        if (token == null || token.isBlank()) {
            throw new AppException(ErrorCode.INVALID_REFRESH_TOKEN);
        }
        TokenRefreshResponse tokens = authService.refresh(new RefreshRequest(token));
        authCookieService.writeRefreshCookie(response, tokens.refreshToken());
        return ApiResponse.<TokenRefreshResponse>builder()
                .data(tokens)
                .build();
    }

    /** Clears the refresh cookie. Public so an expired session can still sign out cleanly. */
    @PostMapping("/logout")
    public ApiResponse<Void> logout(HttpServletResponse response) {
        authCookieService.clearRefreshCookie(response);
        return ApiResponse.<Void>builder().build();
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

    @DeleteMapping("/avatar")
    public ApiResponse<UserResponse> deleteAvatar(@AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<UserResponse>builder()
                .data(authService.deleteAvatar(user.id()))
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
