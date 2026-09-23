package com.app.modules.platform.controller;

import com.app.common.security.AuthenticatedUser;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.entity.UserStatus;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.workspace.entity.Workspace;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import com.app.modules.batch.entity.LocalizationBatch;
import com.app.modules.batch.repository.LocalizationBatchRepository;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.project.entity.Project;
import com.app.modules.project.repository.ProjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
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

    @Autowired
    private MediaJobRepository mediaJobRepository;

    @Autowired
    private LocalizationBatchRepository localizationBatchRepository;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private User adminUser;
    private User normalUser;
    private Workspace adminWs;

    @BeforeEach
    void setup() {
        jdbcTemplate.execute("DELETE FROM ai_usage_logs");
        mediaJobRepository.deleteAll();
        localizationBatchRepository.deleteAll();
        projectRepository.deleteAll();
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

        adminWs = new Workspace();
        adminWs.setName("Admin Workspace");
        adminWs.setSlug("admin-ws");
        adminWs.setOwnerUserId(adminUser.getId());
        adminWs = workspaceRepository.save(adminWs);
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

    @Test
    void testGetOverview_WithRealAggregates_Success() throws Exception {
        authenticateAs(adminUser);

        Project project = new Project();
        project.setWorkspaceId(adminWs.getId());
        project.setName("Admin Project");
        project = projectRepository.save(project);

        // 1. MediaJobs
        MediaJob mj1 = new MediaJob();
        mj1.setWorkspaceId(adminWs.getId());
        mj1.setProjectId(project.getId());
        mj1.setRootAssetId(UUID.randomUUID());
        mj1.setRecipeId(MediaJob.RECIPE_LOCALIZATION_FULL);
        mj1.setTargetLang("vi");
        mj1.setStatus(MediaJob.JobStatus.COMPLETED);
        mj1.setProcessingMode(MediaJob.ProcessingMode.HYBRID);
        mj1.setOutputAudioMode(MediaJob.OutputAudioMode.ORIGINAL_ONLY);
        mj1.setPerformedByUserId(adminUser.getId());
        mj1.setCreatedByUserId(adminUser.getId());
        mediaJobRepository.save(mj1);

        MediaJob mj2 = new MediaJob();
        mj2.setWorkspaceId(adminWs.getId());
        mj2.setProjectId(project.getId());
        mj2.setRootAssetId(UUID.randomUUID());
        mj2.setRecipeId(MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH);
        mj2.setTargetLang("vi");
        mj2.setStatus(MediaJob.JobStatus.FAILED);
        mj2.setProcessingMode(MediaJob.ProcessingMode.TRANSLATE_ONLY);
        mj2.setOutputAudioMode(MediaJob.OutputAudioMode.ORIGINAL_ONLY);
        mj2.setPerformedByUserId(adminUser.getId());
        mj2.setCreatedByUserId(adminUser.getId());
        mediaJobRepository.save(mj2);

        // 2. LocalizationBatches
        LocalizationBatch batch1 = new LocalizationBatch();
        batch1.setWorkspaceId(adminWs.getId());
        batch1.setProjectId(project.getId());
        batch1.setSourceAssetIds(List.of(UUID.randomUUID()));
        batch1.setTargetLang("vi");
        batch1.setStatus(LocalizationBatch.BatchStatus.COMPLETED);
        batch1.setCreatedBy(adminUser.getId());
        batch1.setCreatedAt(Instant.now());
        localizationBatchRepository.save(batch1);

        LocalizationBatch batch2 = new LocalizationBatch();
        batch2.setWorkspaceId(adminWs.getId());
        batch2.setProjectId(project.getId());
        batch2.setSourceAssetIds(List.of(UUID.randomUUID()));
        batch2.setTargetLang("vi");
        batch2.setStatus(LocalizationBatch.BatchStatus.FAILED);
        batch2.setCreatedBy(adminUser.getId());
        batch2.setCreatedAt(Instant.now());
        localizationBatchRepository.save(batch2);

        // 3. AI Usage Logs
        jdbcTemplate.update("""
            INSERT INTO ai_usage_logs (id, workspace_id, project_id, performed_by_user_id, operation, used_personal_api_key, input_tokens, output_tokens, credit_used, created_at)
            VALUES (?, ?, ?, ?, 'TRANSLATE', false, 100, 200, 0.5, now())
        """, UUID.randomUUID(), adminWs.getId(), project.getId(), adminUser.getId());

        jdbcTemplate.update("""
            INSERT INTO ai_usage_logs (id, workspace_id, project_id, performed_by_user_id, operation, used_personal_api_key, input_tokens, output_tokens, credit_used, created_at)
            VALUES (?, ?, ?, ?, 'SUMMARIZE_SCRIPT', false, 50, 50, 0.2, now())
        """, UUID.randomUUID(), adminWs.getId(), project.getId(), adminUser.getId());

        mockMvc.perform(get("/api/platform/overview"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                // Jobs
                .andExpect(jsonPath("$.data.jobs.mediaJobs.created").value(2))
                .andExpect(jsonPath("$.data.jobs.mediaJobs.completed").value(1))
                .andExpect(jsonPath("$.data.jobs.mediaJobs.failed").value(1))
                .andExpect(jsonPath("$.data.jobs.textJobs.created").value(1))
                .andExpect(jsonPath("$.data.jobs.textJobs.failed").value(1))
                .andExpect(jsonPath("$.data.jobs.batchJobs.created").value(2))
                .andExpect(jsonPath("$.data.jobs.batchJobs.completed").value(1))
                .andExpect(jsonPath("$.data.jobs.batchJobs.failed").value(1))
                // Fail Rate: 2 failed / 4 terminal = 0.5
                .andExpect(jsonPath("$.data.failRate.failedCount").value(2))
                .andExpect(jsonPath("$.data.failRate.terminalCount").value(4))
                .andExpect(jsonPath("$.data.failRate.rate").value(0.5))
                // Tokens: 150 in, 250 out, 400 total
                .andExpect(jsonPath("$.data.tokens.inputTokens").value(150))
                .andExpect(jsonPath("$.data.tokens.outputTokens").value(250))
                .andExpect(jsonPath("$.data.tokens.totalTokens").value(400))
                .andExpect(jsonPath("$.data.tokens.byOperation.TRANSLATE.inputTokens").value(100))
                .andExpect(jsonPath("$.data.tokens.byOperation.TRANSLATE.outputTokens").value(200))
                .andExpect(jsonPath("$.data.tokens.byOperation.SUMMARY.inputTokens").value(50))
                // Top Workspaces
                .andExpect(jsonPath("$.data.topWorkspaces[0].workspaceName").value("Admin Workspace"))
                .andExpect(jsonPath("$.data.topWorkspaces[0].totalTokens").value(400))
                .andExpect(jsonPath("$.data.topWorkspaces[0].jobCount").value(4));
    }
}

