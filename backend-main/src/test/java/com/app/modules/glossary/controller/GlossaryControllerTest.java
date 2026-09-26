package com.app.modules.glossary.controller;

import com.app.testsupport.TestRegistration;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.glossary.repository.GlossaryRepository;
import com.app.modules.glossary.repository.GlossaryTermRepository;
import com.app.modules.project.entity.ProjectMember;
import com.app.modules.project.repository.ProjectMemberRepository;
import com.app.modules.project.repository.ProjectRepository;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.WorkspaceMember;
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
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class GlossaryControllerTest {

    @Autowired private MockMvc mockMvc;

    @Autowired
    private com.app.modules.auth.service.RegisterOtpStore registerOtpStore;
    @Autowired private ObjectMapper objectMapper;

    @Autowired private UserRepository userRepository;
    @Autowired private WorkspaceRepository workspaceRepository;
    @Autowired private WorkspaceMemberRepository workspaceMemberRepository;
    @Autowired private ProjectRepository projectRepository;
    @Autowired private ProjectMemberRepository projectMemberRepository;
    @Autowired private GlossaryRepository glossaryRepository;
    @Autowired private GlossaryTermRepository glossaryTermRepository;

    @BeforeEach
    void setUpAndCleanDb() {
        glossaryTermRepository.deleteAll();
        glossaryRepository.deleteAll();
        projectMemberRepository.deleteAll();
        projectRepository.deleteAll();
        workspaceMemberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();
    }

    private record Lead(String accessToken, UUID userId, UUID workspaceId, UUID projectId) {
    }

    private record RegisteredUser(String accessToken, UUID userId) {
    }

    private Lead registerLeadWithWorkspace(String email) throws Exception {
        RegisterRequest req = TestRegistration.withOtp(registerOtpStore, new RegisterRequest(email, "Password123!", "Lead " + email));
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new Lead(
                data.path("accessToken").asText(),
                UUID.fromString(data.path("user").path("id").asText()),
                UUID.fromString(data.path("workspaceId").asText()),
                UUID.fromString(data.path("projectId").asText()));
    }

    private RegisteredUser registerPlainUser(String email) throws Exception {
        RegisterRequest req = TestRegistration.withOtp(registerOtpStore, new RegisterRequest(email, "Password123!", "User " + email));
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new RegisteredUser(data.path("accessToken").asText(), UUID.fromString(data.path("user").path("id").asText()));
    }

    private void addWorkspaceMember(UUID workspaceId, UUID userId, Role role) {
        WorkspaceMember member = new WorkspaceMember();
        member.setWorkspaceId(workspaceId);
        member.setUserId(userId);
        member.setRole(role);
        workspaceMemberRepository.save(member);
    }

    private void addProjectMember(UUID projectId, UUID userId, UUID addedBy) {
        ProjectMember pm = new ProjectMember();
        pm.setProjectId(projectId);
        pm.setUserId(userId);
        pm.setAddedBy(addedBy);
        projectMemberRepository.save(pm);
    }

    // ---- get / auto-create ----

    @Test
    void getGlossary_firstAccess_autoCreatesEmptyGlossary() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-glossary-get@transflow.com");

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.projectId").value(lead.projectId().toString()));

        // Calling again returns the SAME glossary (UNIQUE(project_id) — not a duplicate).
        MvcResult first = mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andReturn();
        String id1 = objectMapper.readTree(first.getResponse().getContentAsString()).path("data").path("id").asText();
        MvcResult second = mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andReturn();
        String id2 = objectMapper.readTree(second.getResponse().getContentAsString()).path("data").path("id").asText();
        org.junit.jupiter.api.Assertions.assertEquals(id1, id2);
        org.junit.jupiter.api.Assertions.assertEquals(1, glossaryRepository.count());
    }

    @Test
    void getGlossary_clientReadAccess_isAllowed() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-glossary-client@transflow.com");
        RegisteredUser client = registerPlainUser("client-glossary@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary")
                        .header("Authorization", "Bearer " + client.accessToken()))
                .andExpect(status().isOk());
    }

    @Test
    void listTerms_firstAccess_autoCreatesEmptyGlossary() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-glossary-terms-first@transflow.com");

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));

        org.junit.jupiter.api.Assertions.assertEquals(1, glossaryRepository.count());
    }

    // ---- term CRUD ----

    @Test
    void createTerm_asLead_succeeds() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-glossary-create@transflow.com");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceTerm\":\"hello\",\"targetTerm\":\"xin chao\",\"targetLang\":\"vi\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.sourceTerm").value("hello"))
                .andExpect(jsonPath("$.data.targetTerm").value("xin chao"))
                .andExpect(jsonPath("$.data.targetLang").value("vi"));

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1));
    }

    @Test
    void createTerm_asClient_isForbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-glossary-client-write@transflow.com");
        RegisteredUser client = registerPlainUser("client-glossary-write@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms")
                        .header("Authorization", "Bearer " + client.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceTerm\":\"hello\",\"targetTerm\":\"xin chao\",\"targetLang\":\"vi\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHORIZED.getCode()));
    }

    @Test
    void updateAndDeleteTerm_asLead_succeed() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-glossary-update@transflow.com");
        MvcResult created = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceTerm\":\"hello\",\"targetTerm\":\"xin chao\",\"targetLang\":\"vi\"}"))
                .andExpect(status().isCreated()).andReturn();
        UUID termId = UUID.fromString(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asText());

        mockMvc.perform(put("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms/" + termId)
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceTerm\":\"hi\",\"targetTerm\":\"chao\",\"targetLang\":\"vi\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sourceTerm").value("hi"));

        mockMvc.perform(delete("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms/" + termId)
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void updateTerm_notFound_returns404() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-glossary-404@transflow.com");

        mockMvc.perform(put("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId()
                        + "/glossary/terms/" + UUID.randomUUID())
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceTerm\":\"a\",\"targetTerm\":\"b\",\"targetLang\":\"en\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(ErrorCode.RESOURCE_NOT_FOUND.getCode()));
    }

    @Test
    void legacyWorkspaceGlossariesRoute_returnsStandardized404() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-glossary-route-404@transflow.com");

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/glossaries")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(ErrorCode.RESOURCE_NOT_FOUND.getCode()));
    }

    // ---- CSV import ----

    @Test
    void importCsv_asLead_importsValidRowsAndReportsInvalid() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-glossary-import@transflow.com");
        String csv = "source_term,target_term,target_lang\n"
                + "hello,xin chao,vi\n"
                + "invalid-row\n"
                + "world,the gioi,vi\n";
        MockMultipartFile file = new MockMultipartFile("file", "terms.csv", "text/csv", csv.getBytes());

        mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms/import")
                        .file(file)
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2))
                .andExpect(jsonPath("$.data.skipped").value(1));

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/glossary/terms")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(jsonPath("$.data.length()").value(2));
    }
}
