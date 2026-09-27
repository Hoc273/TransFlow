package com.app.modules.auth.controller;

import com.app.testsupport.TestRegistration;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.LoginRequest;
import com.app.modules.auth.dto.RefreshRequest;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.entity.UserStatus;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.credit.entity.CostMode;
import com.app.modules.credit.entity.CreditAccount;
import com.app.modules.credit.entity.CreditTransactionType;
import com.app.modules.credit.entity.WorkspaceBillingConfig;
import com.app.modules.credit.repository.CreditAccountRepository;
import com.app.modules.credit.repository.CreditTransactionRepository;
import com.app.modules.credit.repository.WorkspaceBillingConfigRepository;
import com.app.modules.project.entity.Project;
import com.app.modules.project.repository.ProjectRepository;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.Workspace;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

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
    private com.app.modules.auth.service.RegisterOtpStore registerOtpStore;

    @BeforeEach
    void cleanDb() {
        workspaceBillingConfigRepository.deleteAll();
        creditTransactionRepository.deleteAll();
        creditAccountRepository.deleteAll();
        projectRepository.deleteAll();
        workspaceMemberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void testRegisterSuccessAndAutoInit() throws Exception {
        RegisterRequest req = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("lead@transflow.com", "Password123!", "Nguyen Van A"));

        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.data.refreshToken").doesNotExist())
                .andExpect(cookie().httpOnly("tf_refresh", true))
                .andExpect(cookie().secure("tf_refresh", true))
                .andExpect(cookie().path("tf_refresh", "/api/auth"))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("SameSite=Strict")))
                .andExpect(jsonPath("$.data.user.email").value("lead@transflow.com"))
                .andExpect(jsonPath("$.data.user.fullName").value("Nguyen Van A"))
                .andExpect(jsonPath("$.data.user.googleLinked").value(false))
                .andExpect(jsonPath("$.data.workspaceId").isNotEmpty())
                .andExpect(jsonPath("$.data.projectId").isNotEmpty())
                .andReturn();

        JsonNode res = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        UUID userId = UUID.fromString(res.path("user").path("id").asText());
        UUID workspaceId = UUID.fromString(res.path("workspaceId").asText());
        UUID projectId = UUID.fromString(res.path("projectId").asText());

        // Verify Database Auto-Init sequence (Arch §3)
        // 1. User
        User user = userRepository.findById(userId).orElseThrow();
        assertEquals("lead@transflow.com", user.getEmail());
        assertEquals(UserStatus.ACTIVE, user.getStatus());

        // 2. Workspace & LEAD membership
        Workspace ws = workspaceRepository.findById(workspaceId).orElseThrow();
        assertEquals(userId, ws.getOwnerUserId());

        var memberOpt = workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
        assertTrue(memberOpt.isPresent());
        assertEquals(Role.LEAD, memberOpt.get().getRole());

        // 3. Default project
        Project project = projectRepository.findById(projectId).orElseThrow();
        assertEquals(workspaceId, project.getWorkspaceId());
        assertEquals("Default Project", project.getName());

        // 4. Credit account with initial grant
        CreditAccount account = creditAccountRepository.findByUserId(userId).orElseThrow();
        assertEquals(0, new BigDecimal("100.0000").compareTo(account.getBalance()));

        var txs = creditTransactionRepository.findByUserIdOrderByCreatedAtDesc(userId);
        assertFalse(txs.isEmpty());
        assertEquals(CreditTransactionType.INITIAL_GRANT, txs.getFirst().getType());

        // 5. Workspace billing config
        WorkspaceBillingConfig billing = workspaceBillingConfigRepository.findById(workspaceId).orElseThrow();
        assertEquals(CostMode.PAY_PER_USER, billing.getCostMode());
    }

    @Test
    void testRegisterDuplicateEmailReturnsConflict() throws Exception {
        RegisterRequest req = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("dup@transflow.com", "Password123!", "Nguyen Van A"));

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(ErrorCode.EMAIL_ALREADY_EXISTS.getCode()))
                .andExpect(jsonPath("$.message").value(ErrorCode.EMAIL_ALREADY_EXISTS.getMessage()));
    }

    @Test
    void testLoginSuccess() throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("login@transflow.com", "Password123!", "Tran Van B"));
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated());

        LoginRequest login = new LoginRequest("login@transflow.com", "Password123!");
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(login)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.data.refreshToken").doesNotExist())
                .andExpect(cookie().exists("tf_refresh"))
                .andExpect(jsonPath("$.data.user.email").value("login@transflow.com"))
                .andExpect(jsonPath("$.data.workspaceId").isNotEmpty())
                .andExpect(jsonPath("$.data.projectId").isNotEmpty());
    }

    @Test
    void testLoginWrongPassword() throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("user@transflow.com", "Password123!", "Tran Van B"));
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated());

        LoginRequest login = new LoginRequest("user@transflow.com", "WrongPassword!");
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(login)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_CREDENTIALS.getCode()))
                .andExpect(jsonPath("$.message").value(ErrorCode.INVALID_CREDENTIALS.getMessage()));
    }

    @Test
    void testRefreshToken() throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("refresh@transflow.com", "Password123!", "Le Van C"));
        MvcResult regRes = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        jakarta.servlet.http.Cookie refreshCookie = regRes.getResponse().getCookie("tf_refresh");
        assertNotNull(refreshCookie);

        // Browser path: cookie only, no body.
        mockMvc.perform(post("/api/auth/refresh").cookie(refreshCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.data.refreshToken").doesNotExist())
                .andExpect(cookie().httpOnly("tf_refresh", true));

        // Non-browser path: token in JSON body still accepted.
        RefreshRequest refreshReq = new RefreshRequest(refreshCookie.getValue());
        mockMvc.perform(post("/api/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(refreshReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accessToken").isNotEmpty());

        // No cookie and no body -> 401.
        mockMvc.perform(post("/api/auth/refresh"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_REFRESH_TOKEN.getCode()));
    }

    @Test
    void testLogoutClearsRefreshCookie() throws Exception {
        mockMvc.perform(post("/api/auth/logout"))
                .andExpect(status().isOk())
                .andExpect(cookie().maxAge("tf_refresh", 0))
                .andExpect(cookie().httpOnly("tf_refresh", true));
    }

    @Test
    void testRegisterWithoutOtpIsRejected() throws Exception {
        RegisterRequest req = new RegisterRequest("nootp@transflow.com", "Password123!", "No Otp");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.OTP_REQUIRED.getCode()));
        assertFalse(userRepository.existsByEmailIgnoreCase("nootp@transflow.com"));
    }

    @Test
    void testRegisterGmailAliasIsRejected() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(TestRegistration.withOtp(registerOtpStore,
                                new RegisterRequest("john.doe@gmail.com", "Password123!", "John")))))
                .andExpect(status().isCreated());

        for (String alias : new String[]{"johndoe+1@gmail.com", "J.O.H.N.D.O.E@googlemail.com", "john.doe+promo@gmail.com"}) {
            // Both the OTP send and the registration refuse an alias of an existing mailbox.
            mockMvc.perform(post("/api/auth/register/otp")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.RegisterOtpRequest(alias))))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value(ErrorCode.EMAIL_ALREADY_EXISTS.getCode()));
            mockMvc.perform(post("/api/auth/register")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(TestRegistration.withOtp(registerOtpStore,
                                    new RegisterRequest(alias, "Password123!", "Alias")))))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value(ErrorCode.EMAIL_ALREADY_EXISTS.getCode()));
        }
    }

    @Test
    void testRegisterRejectsPasswordOverBcryptLimit() throws Exception {
        // 30 Vietnamese chars x 3 bytes = 90 bytes > 72 even though under the 72-char DTO cap.
        String longPassword = "ệ".repeat(30);
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(TestRegistration.withOtp(registerOtpStore,
                                new RegisterRequest("longpw@transflow.com", longPassword, "Long")))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    @Test
    void testApiResponsesCarrySecurityHeaders() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(header().exists("Permissions-Policy"))
                .andExpect(header().string("Content-Security-Policy",
                        org.hamcrest.Matchers.containsString("frame-ancestors 'none'")));
    }

    @Test
    void testMeEndpointAuthenticatedAndUnauthenticated() throws Exception {
        // Unauthenticated
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHENTICATED.getCode()))
                .andExpect(jsonPath("$.message").value(ErrorCode.UNAUTHENTICATED.getMessage()));

        // Authenticated
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("me@transflow.com", "Password123!", "Pham Van D"));
        MvcResult regRes = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode json = objectMapper.readTree(regRes.getResponse().getContentAsString()).path("data");
        String accessToken = json.path("accessToken").asText();

        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.email").value("me@transflow.com"))
                .andExpect(jsonPath("$.data.fullName").value("Pham Van D"))
                .andExpect(jsonPath("$.data.googleLinked").value(false));
    }

    @Autowired
    private com.app.modules.auth.service.ForgotPasswordOtpStore forgotPasswordOtpStore;

    @Test
    void testForgotPasswordFlowSuccess() throws Exception {
        // 1. Create user
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("reset@transflow.com", "OldPassword123!", "Nguyen Reset"));
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated());

        // 2. Request OTP
        mockMvc.perform(post("/api/auth/forgot-password/otp")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.ForgotPasswordOtpRequest("reset@transflow.com"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.message").isNotEmpty());

        // Save a known OTP for deterministic testing
        forgotPasswordOtpStore.saveOtp("reset@transflow.com", "123456");

        // 3. Verify OTP
        mockMvc.perform(post("/api/auth/forgot-password/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.VerifyPasswordOtpRequest("reset@transflow.com", "123456"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.valid").value(true));

        // 4. Reset Password
        mockMvc.perform(post("/api/auth/forgot-password/reset")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.ResetPasswordOtpRequest("reset@transflow.com", "123456", "NewPassword123!"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.message").isNotEmpty());

        // 5. Old password fails
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest("reset@transflow.com", "OldPassword123!"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_CREDENTIALS.getCode()));

        // 6. New password succeeds
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest("reset@transflow.com", "NewPassword123!"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.accessToken").isNotEmpty());
    }

    @Test
    void testForgotPasswordUserNotFound() throws Exception {
        // Anti-enumeration: unknown email still returns 200 (BACKEND_MISSING_TASKS §8).
        mockMvc.perform(post("/api/auth/forgot-password/otp")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.ForgotPasswordOtpRequest("unknown@transflow.com"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.message").isNotEmpty());
    }

    @Test
    void testForgotPasswordVerify_InvalidOtp() throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("wrongotp@transflow.com", "Password123!", "Wrong Otp"));
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated());

        forgotPasswordOtpStore.saveOtp("wrongotp@transflow.com", "123456");

        mockMvc.perform(post("/api/auth/forgot-password/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.VerifyPasswordOtpRequest("wrongotp@transflow.com", "000000"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_OTP.getCode()));
    }

    @Test
    void testForgotPasswordVerify_MaxAttemptsDeletesOtp() throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("attempts@transflow.com", "Password123!", "Attempts User"));
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated());

        forgotPasswordOtpStore.saveOtp("attempts@transflow.com", "123456");

        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/auth/forgot-password/verify")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.VerifyPasswordOtpRequest("attempts@transflow.com", "000000"))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_OTP.getCode()));
        }

        // OTP deleted after 5 wrong attempts — even the correct OTP now fails.
        mockMvc.perform(post("/api/auth/forgot-password/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.VerifyPasswordOtpRequest("attempts@transflow.com", "123456"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_OTP.getCode()));
    }

    @Test
    void testForgotPasswordReset_WrongOtpAfterVerify() throws Exception {
        // Regression: /reset must re-check the real OTP — a prior /verify must NOT
        // let any arbitrary 6-digit code reset the password.
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("bypass@transflow.com", "Password123!", "Bypass User"));
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated());

        forgotPasswordOtpStore.saveOtp("bypass@transflow.com", "123456");

        mockMvc.perform(post("/api/auth/forgot-password/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.VerifyPasswordOtpRequest("bypass@transflow.com", "123456"))))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/forgot-password/reset")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.ResetPasswordOtpRequest("bypass@transflow.com", "999999", "NewPassword123!"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_OTP.getCode()));
    }

    @Test
    void testForgotPassword_GoogleOnlyAccountCanSetPassword() throws Exception {
        // Google-only account (no password_hash): forgot-password lets them set one.
        User user = new User();
        user.setEmail("googleonly@transflow.com");
        user.setPasswordHash(null);
        user.setFullName("Google Only");
        user.setGoogleSub("google-sub-123");
        user.setGoogleLinked(true);
        user.setStatus(UserStatus.ACTIVE);
        userRepository.save(user);

        mockMvc.perform(post("/api/auth/forgot-password/otp")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.ForgotPasswordOtpRequest("googleonly@transflow.com"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000));

        forgotPasswordOtpStore.saveOtp("googleonly@transflow.com", "123456");

        mockMvc.perform(post("/api/auth/forgot-password/reset")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.ResetPasswordOtpRequest("googleonly@transflow.com", "123456", "NewPassword123!"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest("googleonly@transflow.com", "NewPassword123!"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000));
    }

    @Test
    void testRegisterOtp_Success() throws Exception {
        mockMvc.perform(post("/api/auth/register/otp")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new com.app.modules.auth.dto.RegisterOtpRequest("newuser@transflow.com"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.message").isNotEmpty());

        assertTrue(registerOtpStore.hasOtp("newuser@transflow.com"));
    }

    @Test
    void testRegisterWithOtp_Success() throws Exception {
        registerOtpStore.saveOtp("otpuser@transflow.com", "654321");

        RegisterRequest req = new RegisterRequest("otpuser@transflow.com", "Password123!", "OTP User", "654321");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.user.email").value("otpuser@transflow.com"));

        assertFalse(registerOtpStore.hasOtp("otpuser@transflow.com"));
    }

    @Test
    void testRegisterWithOtp_InvalidOtp() throws Exception {
        registerOtpStore.saveOtp("otpuser2@transflow.com", "654321");

        RegisterRequest req = new RegisterRequest("otpuser2@transflow.com", "Password123!", "OTP User 2", "000000");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_OTP.getCode()));
    }

    @Test
    void testUpdateProfile_Success() throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("profile_test@transflow.com", "Password123!", "Old Name"));
        MvcResult regRes = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode json = objectMapper.readTree(regRes.getResponse().getContentAsString()).path("data");
        String accessToken = json.path("accessToken").asText();

        var updateReq = new com.app.modules.auth.dto.UpdateProfileRequest("New Updated Name");
        mockMvc.perform(put("/api/auth/me")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.fullName").value("New Updated Name"));
    }

    @Test
    void testChangePassword_SuccessAndInvalidCurrent() throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("pw_test@transflow.com", "Password123!", "Pw User"));
        MvcResult regRes = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode json = objectMapper.readTree(regRes.getResponse().getContentAsString()).path("data");
        String accessToken = json.path("accessToken").asText();

        // 1. Wrong current password -> 401 INVALID_CREDENTIALS
        var wrongReq = new com.app.modules.auth.dto.ChangePasswordRequest("WrongPass!", "NewPassword123!");
        mockMvc.perform(put("/api/auth/password")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(wrongReq)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_CREDENTIALS.getCode()));

        // 2. Correct current password -> 200 OK
        var okReq = new com.app.modules.auth.dto.ChangePasswordRequest("Password123!", "NewPassword123!");
        mockMvc.perform(put("/api/auth/password")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(okReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000));

        // 3. Login with new password succeeds
        var newLogin = new LoginRequest("pw_test@transflow.com", "NewPassword123!");
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(newLogin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000));
    }

    @Test
    void testAvatar_UpdateAndDelete() throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest("avatar_test@transflow.com", "Password123!", "Avatar User"));
        MvcResult regRes = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode json = objectMapper.readTree(regRes.getResponse().getContentAsString()).path("data");
        String accessToken = json.path("accessToken").asText();

        // 1. Update avatar
        var updateReq = new com.app.modules.auth.dto.UpdateProfileRequest("Avatar User", "data:image/jpeg;base64,samplebase64");
        mockMvc.perform(put("/api/auth/me")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.avatarUrl").value("data:image/jpeg;base64,samplebase64"));

        // 1b. Script-capable or oversized avatars are refused
        for (String bad : new String[]{"javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=",
                "data:text/html;base64,PGgxPg==", "http://insecure.example/a.png"}) {
            mockMvc.perform(put("/api/auth/me")
                            .header("Authorization", "Bearer " + accessToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    new com.app.modules.auth.dto.UpdateProfileRequest("Avatar User", bad))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value(ErrorCode.INVALID_AVATAR.getCode()));
        }

        // 2. Delete avatar
        mockMvc.perform(delete("/api/auth/avatar")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.avatarUrl").isEmpty());
    }
}
