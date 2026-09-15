package com.app.modules.auth.controller;

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
        RegisterRequest req = new RegisterRequest("lead@transflow.com", "Password123!", "Nguyen Van A");

        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.data.refreshToken").isNotEmpty())
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
        RegisterRequest req = new RegisterRequest("dup@transflow.com", "Password123!", "Nguyen Van A");

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
        RegisterRequest reg = new RegisterRequest("login@transflow.com", "Password123!", "Tran Van B");
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
                .andExpect(jsonPath("$.data.refreshToken").isNotEmpty())
                .andExpect(jsonPath("$.data.user.email").value("login@transflow.com"))
                .andExpect(jsonPath("$.data.workspaceId").isNotEmpty())
                .andExpect(jsonPath("$.data.projectId").isNotEmpty());
    }

    @Test
    void testLoginWrongPassword() throws Exception {
        RegisterRequest reg = new RegisterRequest("user@transflow.com", "Password123!", "Tran Van B");
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
        RegisterRequest reg = new RegisterRequest("refresh@transflow.com", "Password123!", "Le Van C");
        MvcResult regRes = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode json = objectMapper.readTree(regRes.getResponse().getContentAsString()).path("data");
        String refreshToken = json.path("refreshToken").asText();

        RefreshRequest refreshReq = new RefreshRequest(refreshToken);
        mockMvc.perform(post("/api/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(refreshReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.data.refreshToken").isNotEmpty());
    }

    @Test
    void testMeEndpointAuthenticatedAndUnauthenticated() throws Exception {
        // Unauthenticated
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHENTICATED.getCode()))
                .andExpect(jsonPath("$.message").value(ErrorCode.UNAUTHENTICATED.getMessage()));

        // Authenticated
        RegisterRequest reg = new RegisterRequest("me@transflow.com", "Password123!", "Pham Van D");
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
}
