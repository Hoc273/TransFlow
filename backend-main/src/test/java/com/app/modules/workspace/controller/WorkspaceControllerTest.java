package com.app.modules.workspace.controller;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.credit.entity.CostMode;
import com.app.modules.workspace.dto.AddWorkspaceMemberRequest;
import com.app.modules.workspace.dto.CreateWorkspaceRequest;
import com.app.modules.workspace.dto.UpdateBillingConfigRequest;
import com.app.modules.workspace.dto.UpdateMemberRoleRequest;
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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class WorkspaceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private String registerAndGetToken(String email, String name) throws Exception {
        RegisterRequest reg = new RegisterRequest(email, "Password123!", name);
        MvcResult res = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode json = objectMapper.readTree(res.getResponse().getContentAsString()).path("data");
        return json.path("accessToken").asText();
    }

    @Test
    void testWorkspaceFullLifecycle() throws Exception {
        // 1. Register Lead user
        String leadEmail = "lead_" + System.currentTimeMillis() + "@test.com";
        String leadToken = registerAndGetToken(leadEmail, "Lead User");

        // 2. Create Workspace
        CreateWorkspaceRequest createReq = new CreateWorkspaceRequest("Acme Studio", null);
        MvcResult createRes = mockMvc.perform(post("/api/workspaces")
                        .header("Authorization", "Bearer " + leadToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createReq)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.name").value("Acme Studio"))
                .andExpect(jsonPath("$.data.role").value("LEAD"))
                .andReturn();

        String workspaceId = objectMapper.readTree(createRes.getResponse().getContentAsString())
                .path("data").path("id").asText();

        // 3. List my workspaces
        mockMvc.perform(get("/api/workspaces")
                        .header("Authorization", "Bearer " + leadToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data").isArray());

        // 4. Get workspace detail
        mockMvc.perform(get("/api/workspaces/" + workspaceId)
                        .header("Authorization", "Bearer " + leadToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(workspaceId))
                .andExpect(jsonPath("$.data.role").value("LEAD"));

        // 5. Register Member user to invite
        String memberEmail = "member_" + System.currentTimeMillis() + "@test.com";
        registerAndGetToken(memberEmail, "Member User");

        // 6. Invite member
        AddWorkspaceMemberRequest addReq = new AddWorkspaceMemberRequest(memberEmail, Role.MEMBER);
        MvcResult addRes = mockMvc.perform(post("/api/workspaces/" + workspaceId + "/members")
                        .header("Authorization", "Bearer " + leadToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(addReq)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.email").value(memberEmail))
                .andExpect(jsonPath("$.data.role").value("MEMBER"))
                .andReturn();

        String memberId = objectMapper.readTree(addRes.getResponse().getContentAsString())
                .path("data").path("memberId").asText();

        // 7. List members
        mockMvc.perform(get("/api/workspaces/" + workspaceId + "/members")
                        .header("Authorization", "Bearer " + leadToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").isArray());

        // 8. Update member role to CLIENT
        UpdateMemberRoleRequest updateRoleReq = new UpdateMemberRoleRequest(Role.CLIENT);
        mockMvc.perform(put("/api/workspaces/" + workspaceId + "/members/" + memberId)
                        .header("Authorization", "Bearer " + leadToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateRoleReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.role").value("CLIENT"));

        // 9. Billing config get & update
        mockMvc.perform(get("/api/workspaces/" + workspaceId + "/billing-config")
                        .header("Authorization", "Bearer " + leadToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.costMode").value("PAY_PER_USER"));

        UpdateBillingConfigRequest billingReq = new UpdateBillingConfigRequest(CostMode.LEAD_PAYS_ALL);
        mockMvc.perform(put("/api/workspaces/" + workspaceId + "/billing-config")
                        .header("Authorization", "Bearer " + leadToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(billingReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.costMode").value("LEAD_PAYS_ALL"));

        // 10. Delete member
        mockMvc.perform(delete("/api/workspaces/" + workspaceId + "/members/" + memberId)
                        .header("Authorization", "Bearer " + leadToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000));
    }

    @Test
    void testLeadRoleProtection() throws Exception {
        String leadEmail = "lead_prot_" + System.currentTimeMillis() + "@test.com";
        String leadToken = registerAndGetToken(leadEmail, "Lead Protect");

        CreateWorkspaceRequest createReq = new CreateWorkspaceRequest("Protected WS", null);
        MvcResult createRes = mockMvc.perform(post("/api/workspaces")
                        .header("Authorization", "Bearer " + leadToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createReq)))
                .andExpect(status().isCreated())
                .andReturn();

        String workspaceId = objectMapper.readTree(createRes.getResponse().getContentAsString())
                .path("data").path("id").asText();

        // Try to add another LEAD
        AddWorkspaceMemberRequest addLeadReq = new AddWorkspaceMemberRequest("someone@test.com", Role.LEAD);
        mockMvc.perform(post("/api/workspaces/" + workspaceId + "/members")
                        .header("Authorization", "Bearer " + leadToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(addLeadReq)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.CANNOT_ASSIGN_LEAD_ROLE.getCode()));
    }
}
