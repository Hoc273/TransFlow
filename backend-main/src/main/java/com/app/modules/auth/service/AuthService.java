package com.app.modules.auth.service;

import com.app.modules.auth.dto.*;
import com.app.modules.auth.entity.User;

import java.util.*;

/**
 * Authentication service interface (API_Contract.md §1 & CLAUDE_A.md §4.8).
 */
public interface AuthService {

    String OAUTH_ONLY_PASSWORD_MESSAGE =
            "This account signs in with Google. Use Continue with Google, or set a password in Settings.";

    AuthResponse register(RegisterRequest req);

    OtpMessageResponse sendRegisterOtp(RegisterOtpRequest req);

    AuthResponse login(LoginRequest req);

    TokenRefreshResponse refresh(RefreshRequest req);

    UserResponse me(UUID userId);

    UserResponse updateProfile(UUID userId, UpdateProfileRequest req);

    UserResponse deleteAvatar(UUID userId);

    void changePassword(UUID userId, ChangePasswordRequest req);

    Optional<UserResponse> findUserById(UUID userId);

    Map<UUID, UserResponse> findUsersByIds(Collection<UUID> userIds);

    Optional<UserResponse> findUserByEmail(String email);

    WorkspaceProjectInit initDefaultWorkspaceAndCredit(User user);

    WorkspaceProjectInit resolveOrCreateDefaultWorkspaceAndProject(User user);

    AuthResponse issueAuthTokens(User user, UUID workspaceId, UUID projectId);

    OtpMessageResponse sendForgotPasswordOtp(ForgotPasswordOtpRequest req);

    OtpVerifyResponse verifyForgotPasswordOtp(VerifyPasswordOtpRequest req);

    OtpMessageResponse resetPasswordWithOtp(ResetPasswordOtpRequest req);

    record WorkspaceProjectInit(UUID workspaceId, UUID projectId) {}
}
