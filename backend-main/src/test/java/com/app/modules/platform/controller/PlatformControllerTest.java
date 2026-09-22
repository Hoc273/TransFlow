package com.app.modules.platform.controller;

import com.app.common.security.AuthenticatedUser;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.entity.UserStatus;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.workspace.entity.Workspace;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.UUID;

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

    private User adminUser;
    private User normalUser;

    @BeforeEach
    void setup() {
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
                .andExpect(jsonPath("$.data.workspaces.total").value(1));
    }

    @Test
    void testGetStatus_AsAdmin_Success() throws Exception {
        authenticateAs(adminUser);

        // Honest health: redis/rabbit/minio/ai are not running in tests,
        // so overall is DEGRADED while DB stays UP.
        mockMvc.perform(get("/api/platform/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.services").isArray())
                .andExpect(jsonPath("$.data.services.length()").value(5))
                .andExpect(jsonPath("$.data.services[0].id").value("db"))
                .andExpect(jsonPath("$.data.services[0].status").value("UP"));
    }

    @Test
    void testGetUsers_AsAdmin_Success() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.totalItems").value(2))
                .andExpect(jsonPath("$.data.items[0].email").isNotEmpty());
    }

    @Test
    void testGetOverview_AsNormalUser_Forbidden() throws Exception {
        authenticateAs(normalUser);

        mockMvc.perform(get("/api/platform/overview"))
                .andExpect(status().isForbidden());
    }

    @Test
    void testGetUsers_FilterByQ() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users").param("q", "admin@"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalItems").value(1))
                .andExpect(jsonPath("$.data.items[0].email").value("admin@transflow.com"));

        mockMvc.perform(get("/api/platform/users").param("q", "no-such-user"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalItems").value(0));
    }

    @Test
    void testGetUsers_FilterByIsPlatformAdmin() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users").param("isPlatformAdmin", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalItems").value(1))
                .andExpect(jsonPath("$.data.items[0].email").value("admin@transflow.com"));

        mockMvc.perform(get("/api/platform/users").param("isPlatformAdmin", "false"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalItems").value(1))
                .andExpect(jsonPath("$.data.items[0].email").value("user@transflow.com"));
    }

    @Test
    void testGetUsers_SizeClampedTo100() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/users").param("size", "500"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.size").value(100));
    }

    @Test
    void testGetWorkspaces_FilterByQ() throws Exception {
        authenticateAs(adminUser);

        mockMvc.perform(get("/api/platform/workspaces").param("q", "admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalItems").value(1));

        mockMvc.perform(get("/api/platform/workspaces").param("q", "no-such-ws"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalItems").value(0));
    }
}
