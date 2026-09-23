package com.app.modules.platform.controller;

import com.app.common.security.AuthenticatedUser;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.entity.UserStatus;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.platform.entity.PlatformAdminAuditAction;
import com.app.modules.platform.repository.PlatformAdminAuditLogRepository;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.Workspace;
import com.app.modules.workspace.entity.WorkspaceMember;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class PlatformControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository workspaceMemberRepository;

    @Autowired
    private PlatformAdminAuditLogRepository auditLogRepository;

    private User adminUser;
    private User normalUser;

    @BeforeEach
    void setup() {
        auditLogRepository.deleteAll();
        workspaceMemberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();

        adminUser = new User();
        adminUser.setEmail("admin@transflow.com");
        adminUser.setFullName("Super Admin");
        adminUser.setPasswordHash("hashed");
        adminUser.setStatus(UserStatus.ACTIVE);
        adminUser.setPlatformAdmin(true);
        adminUser = userRepository.save(adminUser);

        normalUser = new User();
        normalUser.setEmail("user@transflow.com");
        normalUser.setFullName("Normal User");
        normalUser.setPasswordHash("hashed");
        normalUser.setStatus(UserStatus.ACTIVE);
        normalUser.setPlatformAdmin(false);
        normalUser = userRepository.save(normalUser);

        Workspace ws = new Workspace();
        ws.setName("Admin Workspace");
        ws.setSlug("admin-ws");
        ws.setOwnerUserId(adminUser.getId());
        workspaceRepository.save(ws);
    }

    private void authenticateAs(User user) {
        AuthenticatedUser authUser = new AuthenticatedUser(user.getId(), user.getEmail());
        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(authUser, null, Collections.emptyList());
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    @Test
    void testGetOverview_AsAdmin_Success() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/overview"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.users.total").value(2))
                .andExpect(jsonPath("$.data.workspaces.total").value(1))
                .andExpect(jsonPath("$.data.jobs.mediaJobs.created").exists())
                .andExpect(jsonPath("$.data.jobs.batchJobs.created").exists())
                .andExpect(jsonPath("$.data.jobs.textJobs.available").value(false))
                .andExpect(jsonPath("$.data.jobs.productionJobs.available").value(false))
                .andExpect(jsonPath("$.data.tokens.totalTokens").exists())
                .andExpect(jsonPath("$.data.failRate.terminalCount").exists());
    }

    @Test
    void testGetOverview_InvalidRange_BadRequest() throws Exception {
        authenticateAs(adminUser);
        Instant to = Instant.now();
        Instant from = to.plusSeconds(60);

        mockMvc.perform(get("/api/platform/overview")
                        .param("from", from.toString())
                        .param("to", to.toString()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void testGetStatus_AsAdmin_Success() throws Exception {
        authenticateAs(adminUser);

        // Honest health: redis/rabbitmq/minio/ai are not running in tests,
        // so overall is DEGRADED while postgresql stays UP.
        mockMvc.perform(get("/api/platform/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.overall").value("DEGRADED"))
                .andExpect(jsonPath("$.data.services").isArray())
                .andExpect(jsonPath("$.data.services.length()").value(6))
                .andExpect(jsonPath("$.data.services[0].id").value("postgresql"))
                .andExpect(jsonPath("$.data.services[0].status").value("UP"));
    }

    @Test
    void testGetUsers_AsAdmin_Success() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.totalElements").value(2))
                .andExpect(jsonPath("$.data.content[0].email").isNotEmpty());
    }

    @Test
    void testGetUsers_AsNormalUser_Forbidden() throws Exception {
        authenticateAs(normalUser);

        mockMvc.perform(get("/api/platform/users"))
                .andExpect(status().isForbidden());
    }

    @Test
    void testGetOverview_AsNormalUser_Forbidden() throws Exception {
        authenticateAs(normalUser);

        mockMvc.perform(get("/api/platform/overview"))
                .andExpect(status().isForbidden());
    }

    @Test
    void testGetOverview_Unauthenticated_Unauthorized() throws Exception {
        SecurityContextHolder.clearContext();

        mockMvc.perform(get("/api/platform/overview"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void testGetUsers_FilterByQ() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users").param("q", "admin@"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].email").value("admin@transflow.com"));

        mockMvc.perform(get("/api/platform/users").param("q", "no-such-user"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(0));
    }

    @Test
    void testGetUsers_FilterByIsPlatformAdmin() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users").param("isPlatformAdmin", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].email").value("admin@transflow.com"));

        mockMvc.perform(get("/api/platform/users").param("isPlatformAdmin", "false"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].email").value("user@transflow.com"));
    }

    @Test
    void testGetUsers_SizeClampedTo100() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users").param("size", "500"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.size").value(100));
    }

    @Test
    void testGetWorkspaces_AsAdmin_Success() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/workspaces"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].slug").value("admin-ws"))
                .andExpect(jsonPath("$.data.content[0].ownerEmail").value("admin@transflow.com"));
    }

    @Test
    void testGetWorkspaces_FilterByQ() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/workspaces").param("q", "admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1));

        mockMvc.perform(get("/api/platform/workspaces").param("q", "no-such-ws"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(0));
    }

    @Test
    void testGetAuditLogs_AsAdmin_Success() throws Exception {
        authenticateAs(adminUser);

        // Trigger one auditable call first.
        mockMvc.perform(get("/api/platform/overview")).andExpect(status().isOk());

        // The audit row for /audit-logs itself is appended after the request
        // completes, so the query sees only the earlier VIEW_OVERVIEW row.
        mockMvc.perform(get("/api/platform/audit-logs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].action").value("VIEW_OVERVIEW"));

        // ...and by now the LIST_AUDIT row for that very request exists too.
        assertThat(auditLogRepository.findFiltered(PlatformAdminAuditAction.LIST_AUDIT,
                PageRequest.of(0, 10)).getTotalElements()).isEqualTo(1);
    }

    @Test
    void testGetAuditLogs_FilterByAction() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/overview")).andExpect(status().isOk());

        mockMvc.perform(get("/api/platform/audit-logs").param("action", "VIEW_OVERVIEW"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].action").value("VIEW_OVERVIEW"));
    }

    @Test
    void testGetAuditLogs_UnknownAction_BadRequest() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/audit-logs").param("action", "NOPE"))
                .andExpect(status().isBadRequest());

        // A 400 validation error is NOT an auth denial: the audit row keeps the
        // attempted action (LIST_AUDIT), DENIED is reserved for 401/403.
        assertThat(auditLogRepository.findFiltered(PlatformAdminAuditAction.LIST_AUDIT,
                PageRequest.of(0, 10)).getTotalElements()).isEqualTo(1);
        assertThat(auditLogRepository.findFiltered(PlatformAdminAuditAction.DENIED,
                PageRequest.of(0, 10)).getTotalElements()).isEqualTo(0);
    }

    @Test
    void testAuditLog_DeniedRequestRecorded() throws Exception {
        authenticateAs(normalUser);

        mockMvc.perform(get("/api/platform/users"))
                .andExpect(status().isForbidden());

        var rows = auditLogRepository.findFiltered(PlatformAdminAuditAction.DENIED,
                PageRequest.of(0, 10));
        assertThat(rows.getTotalElements()).isEqualTo(1);
        assertThat(rows.getContent().get(0).getActorUserId()).isEqualTo(normalUser.getId());
        assertThat(rows.getContent().get(0).getStatusCode()).isEqualTo(403);
    }

    @Test
    void testAuditLog_UnauthenticatedRecordedAsDenied() throws Exception {
        SecurityContextHolder.clearContext();

        mockMvc.perform(get("/api/platform/overview"))
                .andExpect(status().isUnauthorized());

        var rows = auditLogRepository.findFiltered(PlatformAdminAuditAction.DENIED,
                PageRequest.of(0, 10));
        assertThat(rows.getTotalElements()).isEqualTo(1);
        assertThat(rows.getContent().get(0).getActorUserId()).isNull();
        assertThat(rows.getContent().get(0).getStatusCode()).isEqualTo(401);
    }

    @Test
    void testGetUsers_LikeWildcardsAreEscaped() throws Exception {
        // "user_a" must match the literal underscore only, not "user<a>".
        User literal = new User();
        literal.setEmail("user_a@transflow.com");
        literal.setFullName("Literal Underscore");
        literal.setPasswordHash("hashed");
        literal.setStatus(UserStatus.ACTIVE);
        literal.setPlatformAdmin(false);
        userRepository.save(literal);

        User wildcardMatch = new User();
        wildcardMatch.setEmail("userxa@transflow.com");
        wildcardMatch.setFullName("Wildcard Target");
        wildcardMatch.setPasswordHash("hashed");
        wildcardMatch.setStatus(UserStatus.ACTIVE);
        wildcardMatch.setPlatformAdmin(false);
        userRepository.save(wildcardMatch);

        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users").param("q", "user_a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].email").value("user_a@transflow.com"));
    }

    @Test
    void testGetUsers_CountQueryIgnoresMembershipFanOut() throws Exception {
        // A user with two memberships must still count once (countQuery drops
        // the LEFT JOIN that inflates derived grouped counts).
        Workspace ws2 = new Workspace();
        ws2.setName("Second Workspace");
        ws2.setSlug("second-ws");
        ws2.setOwnerUserId(adminUser.getId());
        ws2 = workspaceRepository.save(ws2);

        WorkspaceMember m1 = new WorkspaceMember();
        m1.setUserId(normalUser.getId());
        m1.setWorkspaceId(workspaceRepository.findAll().get(0).getId());
        m1.setRole(Role.MEMBER);
        workspaceMemberRepository.save(m1);

        WorkspaceMember m2 = new WorkspaceMember();
        m2.setUserId(normalUser.getId());
        m2.setWorkspaceId(ws2.getId());
        m2.setRole(Role.MEMBER);
        workspaceMemberRepository.save(m2);

        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2))
                .andExpect(jsonPath("$.data.content[?(@.email=='user@transflow.com')].workspaceCount")
                        .value(org.hamcrest.Matchers.contains(2)));
    }
}
