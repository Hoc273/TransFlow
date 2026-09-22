package com.app.modules.auth.service.oauth;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.common.security.JwtService;
import com.app.modules.auth.dto.AuthResponse;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.auth.service.AuthService;
import com.app.modules.credit.repository.CreditAccountRepository;
import com.app.modules.credit.repository.CreditTransactionRepository;
import com.app.modules.credit.repository.WorkspaceBillingConfigRepository;
import com.app.modules.project.repository.ProjectRepository;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@SpringBootTest
class GoogleOAuthServiceTest {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository workspaceMemberRepository;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private CreditAccountRepository creditAccountRepository;

    @Autowired
    private CreditTransactionRepository creditTransactionRepository;

    @Autowired
    private WorkspaceBillingConfigRepository workspaceBillingConfigRepository;

    @Autowired
    private AuthService authService;

    @Autowired
    private GoogleOAuthService googleOAuthService;

    @Autowired
    private GoogleOAuthSessionStore sessionStore;

    @MockBean
    private GoogleTokenClient tokenClient;

    @BeforeEach
    void setUp() {
        workspaceBillingConfigRepository.deleteAll();
        creditTransactionRepository.deleteAll();
        creditAccountRepository.deleteAll();
        projectRepository.deleteAll();
        workspaceMemberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void testBuildAuthorizationUrl() {
        String authUrl = googleOAuthService.buildAuthorizationUrl("login", "/w/default");
        assertNotNull(authUrl);
        assertTrue(authUrl.contains("client_id=test-client-id"));
        assertTrue(authUrl.contains("response_type=code"));
        assertTrue(authUrl.contains("code_challenge="));
        assertTrue(authUrl.contains("code_challenge_method=S256"));
    }

    @Test
    void testGoogleCallbackAndExchangeForNewUser() {
        // 1. Build auth url to store state in sessionStore
        String authUrl = googleOAuthService.buildAuthorizationUrl("login", null);
        String state = authUrl.substring(authUrl.indexOf("state=") + 6);
        if (state.contains("&")) {
            state = state.substring(0, state.indexOf("&"));
        }

        // 2. Mock token exchange response from Google
        GoogleTokenClient.GoogleProfile profile = new GoogleTokenClient.GoogleProfile(
                "google-sub-12345",
                "googleuser@transflow.com",
                true,
                "Google User Test",
                "https://avatar.url"
        );
        when(tokenClient.exchangeCode(anyString(), anyString())).thenReturn(profile);

        // 3. Callback
        String feRedirect = googleOAuthService.handleCallback("mock-google-code", state, null);
        assertNotNull(feRedirect);
        assertTrue(feRedirect.contains("/auth/google/done?code="));

        String exchangeCode = feRedirect.substring(feRedirect.indexOf("code=") + 5);

        // 4. Exchange
        AuthResponse authRes = googleOAuthService.exchange(exchangeCode);
        assertNotNull(authRes.accessToken());
        assertNotNull(authRes.refreshToken());
        assertEquals("googleuser@transflow.com", authRes.user().email());
        assertEquals("Google User Test", authRes.user().fullName());
        assertTrue(authRes.user().googleLinked());
        assertNotNull(authRes.workspaceId());
        assertNotNull(authRes.projectId());

        // Verify Auto-Init occurred
        User user = userRepository.findByEmailIgnoreCase("googleuser@transflow.com").orElseThrow();
        assertEquals("google-sub-12345", user.getGoogleSub());
        assertTrue(user.isGoogleLinked());

        var memberOpt = workspaceMemberRepository.findByWorkspaceIdAndUserId(authRes.workspaceId(), user.getId());
        assertTrue(memberOpt.isPresent());
        assertEquals(Role.LEAD, memberOpt.get().getRole());

        var creditOpt = creditAccountRepository.findByUserId(user.getId());
        assertTrue(creditOpt.isPresent());
        assertEquals(0, new BigDecimal("100.0000").compareTo(creditOpt.get().getBalance()));
    }

    @Test
    void testExchange_InvalidCode_ThrowsGoogleOAuthFailed() {
        // One-time exchange code is not a refresh token — API_Contract §15.3 maps this
        // failure to GOOGLE_OAUTH_FAILED (2006), not INVALID_REFRESH_TOKEN (2004).
        AppException ex = assertThrows(AppException.class,
                () -> googleOAuthService.exchange("bad-or-expired-code"));
        assertEquals(ErrorCode.GOOGLE_OAUTH_FAILED, ex.getErrorCode());
    }
}
