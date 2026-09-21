package com.app.modules.project.controller;

import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.project.dto.AssignProjectMemberRequest;
import com.app.modules.project.dto.CreateProjectRequest;
import com.app.modules.workspace.dto.AddWorkspaceMemberRequest;
import com.app.modules.workspace.dto.CreateWorkspaceRequest;
import com.app.modules.workspace.entity.Role;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class ProjectControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private record AuthInfo(String token, UUID userId, UUID defaultWorkspaceId) {}

    private AuthInfo register(String email, String name) throws Exception {
        RegisterRequest reg = new RegisterRequest(email, "Password123!", name);
        MvcResult res = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode data = objectMapper.readTree(res.getResponse().getContentAsString()).path("data");
        String token = data.path("accessToken").asText();
        UUID userId = UUID.fromString(data.path("user").path("id").asText());
        UUID wsId = UUID.fromString(data.path("workspaceId").asText());
        return new AuthInfo(token, userId, wsId);
    }

    @Test
    void testProjectLifecycleAndAssignment() throws Exception {
        // 1. Register Lead & Member
        String leadEmail = "lead_proj_" + System.currentTimeMillis() + "@test.com";
        AuthInfo lead = register(leadEmail, "Lead Proj");

        String memberEmail = "member_proj_" + System.currentTimeMillis() + "@test.com";
        AuthInfo member = register(memberEmail, "Member Proj");

        // 2. Create Workspace by Lead
        CreateWorkspaceRequest wsReq = new CreateWorkspaceRequest("Project Studio", null);
        MvcResult wsRes = mockMvc.perform(post("/api/workspaces")
                        .header("Authorization", "Bearer " + lead.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(wsReq)))
                .andExpect(status().isCreated())
                .andReturn();
        String workspaceId = objectMapper.readTree(wsRes.getResponse().getContentAsString())
                .path("data").path("id").asText();

        // 3. Add Member to Workspace as MEMBER role
        AddWorkspaceMemberRequest addReq = new AddWorkspaceMemberRequest(memberEmail, Role.MEMBER);
        mockMvc.perform(post("/api/workspaces/" + workspaceId + "/members")
                        .header("Authorization", "Bearer " + lead.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(addReq)))
                .andExpect(status().isCreated());

        // 4. Create a Project by Lead
        CreateProjectRequest projReq = new CreateProjectRequest("Video Localization", "en");
        MvcResult projRes = mockMvc.perform(post("/api/workspaces/" + workspaceId + "/projects")
                        .header("Authorization", "Bearer " + lead.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(projReq)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.name").value("Video Localization"))
                .andReturn();

        String projectId = objectMapper.readTree(projRes.getResponse().getContentAsString())
                .path("data").path("id").asText();

        // 5. Member lists projects in workspace (before assignment) -> should not see the new project
        MvcResult memListBefore = mockMvc.perform(get("/api/workspaces/" + workspaceId + "/projects")
                        .header("Authorization", "Bearer " + member.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andReturn();

        JsonNode beforeList = objectMapper.readTree(memListBefore.getResponse().getContentAsString()).path("data");
        boolean foundBefore = false;
        for (JsonNode item : beforeList) {
            if (projectId.equals(item.path("id").asText())) {
                foundBefore = true;
                break;
            }
        }
        assertFalse(foundBefore, "Member should not see unassigned project");

        // 6. Lead assigns Member to Project
        AssignProjectMemberRequest assignReq = new AssignProjectMemberRequest(member.userId());
        mockMvc.perform(post("/api/workspaces/" + workspaceId + "/projects/" + projectId + "/members")
                        .header("Authorization", "Bearer " + lead.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(assignReq)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.userId").value(member.userId().toString()))
                .andExpect(jsonPath("$.data.role").value("MEMBER"));

        // 7. Member lists projects now -> should see the project!
        MvcResult memListAfter = mockMvc.perform(get("/api/workspaces/" + workspaceId + "/projects")
                        .header("Authorization", "Bearer " + member.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andReturn();

        JsonNode afterList = objectMapper.readTree(memListAfter.getResponse().getContentAsString()).path("data");
        boolean foundAfter = false;
        for (JsonNode item : afterList) {
            if (projectId.equals(item.path("id").asText())) {
                foundAfter = true;
                break;
            }
        }
        assertTrue(foundAfter, "Member should now see assigned project");

        // 8. Lead lists project members
        mockMvc.perform(get("/api/workspaces/" + workspaceId + "/projects/" + projectId + "/members")
                        .header("Authorization", "Bearer " + lead.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data[0].userId").value(member.userId().toString()));

        // 9. Lead unassigns Member from Project
        mockMvc.perform(delete("/api/workspaces/" + workspaceId + "/projects/" + projectId + "/members/" + member.userId())
                        .header("Authorization", "Bearer " + lead.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000));

        // 10. Member lists projects again -> no longer sees it
        MvcResult memListFinal = mockMvc.perform(get("/api/workspaces/" + workspaceId + "/projects")
                        .header("Authorization", "Bearer " + member.token()))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode finalList = objectMapper.readTree(memListFinal.getResponse().getContentAsString()).path("data");
        boolean foundFinal = false;
        for (JsonNode item : finalList) {
            if (projectId.equals(item.path("id").asText())) {
                foundFinal = true;
                break;
            }
        }
        assertFalse(foundFinal, "Member should not see project after being unassigned");
    }

    @Test
    void testCreateProjectWithAllFields() throws Exception {
        String leadEmail = "lead_proj_fields_" + System.currentTimeMillis() + "@test.com";
        AuthInfo lead = register(leadEmail, "Lead Proj Fields");

        CreateWorkspaceRequest wsReq = new CreateWorkspaceRequest("Project Studio Fields", null);
        MvcResult wsRes = mockMvc.perform(post("/api/workspaces")
                        .header("Authorization", "Bearer " + lead.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(wsReq)))
                .andExpect(status().isCreated())
                .andReturn();
        String workspaceId = objectMapper.readTree(wsRes.getResponse().getContentAsString())
                .path("data").path("id").asText();

        UUID glossaryId = UUID.randomUUID();
        CreateProjectRequest projReq = new CreateProjectRequest(
                "AI Video Localization",
                "ja",
                glossaryId,
                true,
                "Technology",
                "Professional"
        );

        mockMvc.perform(post("/api/workspaces/" + workspaceId + "/projects")
                        .header("Authorization", "Bearer " + lead.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(projReq)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.name").value("AI Video Localization"))
                .andExpect(jsonPath("$.data.sourceLang").value("ja"))
                .andExpect(jsonPath("$.data.defaultGlossaryId").value(glossaryId.toString()))
                .andExpect(jsonPath("$.data.tmEnabled").value(true))
                .andExpect(jsonPath("$.data.domain").value("Technology"))
                .andExpect(jsonPath("$.data.tone").value("Professional"));
    }
}
