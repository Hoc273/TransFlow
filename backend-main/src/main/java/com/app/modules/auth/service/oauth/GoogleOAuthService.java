package com.app.modules.auth.service.oauth;

import com.app.modules.auth.dto.AuthResponse;

/**
 * Backend-mediated Google OAuth 2.0 / OIDC service interface.
 */
public interface GoogleOAuthService {

    String buildAuthorizationUrl(String mode, String redirect);

    String handleCallback(String code, String state, String errorFromGoogle);

    AuthResponse exchange(String code);

    boolean isConfigured();

    String buildErrorUrl(String error);
}
