package com.app.modules.auth.service;

import com.app.modules.auth.dto.*;
import com.app.modules.auth.entity.User;

import java.util.UUID;

/**
 * Authentication service interface (API_Contract.md §1 & CLAUDE_A.md §4.8).
 */
public interface AuthService {

    String OAUTH_ONLY_PASSWORD_MESSAGE =
            "This account signs in with Google. Use Continue with Google, or set a password in Settings.";

    AuthResponse register(RegisterRequest req);

    AuthResponse login(LoginRequest req);

    TokenRefreshResponse refresh(RefreshRequest req);

    UserResponse me(UUID userId);

    WorkspaceProjectInit initDefaultWorkspaceAndCredit(User user);

    WorkspaceProjectInit resolveOrCreateDefaultWorkspaceAndProject(User user);

    AuthResponse issueAuthTokens(User user, UUID workspaceId, UUID projectId);

    record WorkspaceProjectInit(UUID workspaceId, UUID projectId) {}
}
