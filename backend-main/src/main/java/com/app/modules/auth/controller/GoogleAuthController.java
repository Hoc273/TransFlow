package com.app.modules.auth.controller;

import com.app.common.dto.ApiResponse;
import com.app.modules.auth.dto.AuthResponse;
import com.app.modules.auth.dto.GoogleExchangeRequest;
import com.app.modules.auth.service.AuthCookieService;
import com.app.modules.auth.service.oauth.GoogleOAuthService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;

/**
 * Google OAuth endpoints (API_Contract.md §1 & docs/api-response-convention.md).
 * Public: start / callback / exchange.
 */
@RestController
@RequestMapping("/api/auth/google")
public class GoogleAuthController {

    private final GoogleOAuthService googleOAuthService;
    private final AuthCookieService authCookieService;

    public GoogleAuthController(GoogleOAuthService googleOAuthService, AuthCookieService authCookieService) {
        this.googleOAuthService = googleOAuthService;
        this.authCookieService = authCookieService;
    }

    @GetMapping("/start")
    public void start(@RequestParam(value = "mode", required = false) String mode,
                      @RequestParam(value = "redirect", required = false) String redirect,
                      HttpServletResponse response) throws IOException {
        if (!googleOAuthService.isConfigured()) {
            response.sendRedirect(googleOAuthService.buildErrorUrl("google_not_configured"));
            return;
        }
        String authorizeUrl = googleOAuthService.buildAuthorizationUrl(mode, redirect);
        response.sendRedirect(authorizeUrl);
    }

    @GetMapping("/callback")
    public void callback(@RequestParam(value = "code", required = false) String code,
                         @RequestParam(value = "state", required = false) String state,
                         @RequestParam(value = "error", required = false) String error,
                         HttpServletResponse response) throws IOException {
        String feRedirect = googleOAuthService.handleCallback(code, state, error);
        response.sendRedirect(feRedirect);
    }

    @PostMapping("/exchange")
    public ApiResponse<AuthResponse> exchange(@Valid @RequestBody GoogleExchangeRequest req,
                                              HttpServletResponse response) {
        AuthResponse auth = googleOAuthService.exchange(req.code());
        authCookieService.writeRefreshCookie(response, auth.refreshToken());
        return ApiResponse.<AuthResponse>builder()
                .data(auth)
                .build();
    }
}
