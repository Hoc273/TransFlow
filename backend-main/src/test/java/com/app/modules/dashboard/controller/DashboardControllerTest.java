package com.app.modules.dashboard.controller;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class DashboardControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private record AuthContext(String token, UUID userId, UUID workspaceId, UUID projectId) {}

    private AuthContext registerUser(String email) throws Exception {
        RegisterRequest req = new RegisterRequest(email, "Password123!", "Dashboard Test User");
        MvcResult res = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode data = objectMapper.readTree(res.getResponse().getContentAsString()).path("data");
        String token = data.path("accessToken").asText();
        UUID uId = UUID.fromString(data.path("user").path("id").asText());
        UUID wsId = UUID.fromString(data.path("workspaceId").asText());
        UUID pId = UUID.fromString(data.path("projectId").asText());
        return new AuthContext(token, uId, wsId, pId);
    }

    @Test
    @DisplayName("GET /api/workspaces/{workspaceId}/dashboard returns summary overview")
    void getDashboard_success() throws Exception {
        AuthContext auth = registerUser("dash_overview_" + System.currentTimeMillis() + "@test.com");

        mockMvc.perform(get("/api/workspaces/{workspaceId}/dashboard", auth.workspaceId())
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data.jobs.total").isNumber())
                .andExpect(jsonPath("$.data.batches.total").isNumber())
                .andExpect(jsonPath("$.data.credit.balance").isNumber())
                .andExpect(jsonPath("$.data.credit.costMode").isNotEmpty());
    }

    @Test
    @DisplayName("GET /api/workspaces/{workspaceId}/usage returns usage telemetry")
    void getUsage_success() throws Exception {
        AuthContext auth = registerUser("dash_usage_" + System.currentTimeMillis() + "@test.com");

        mockMvc.perform(get("/api/workspaces/{workspaceId}/usage", auth.workspaceId())
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data.totalTokens").isNumber())
                .andExpect(jsonPath("$.data.totalOperations").isNumber())
                .andExpect(jsonPath("$.data.items").isArray());
    }

    @Test
    @DisplayName("GET /api/workspaces/{workspaceId}/dashboard/usage alias with groupBy works")
    void getUsage_aliasWithGroupBy_success() throws Exception {
        AuthContext auth = registerUser("dash_alias_" + System.currentTimeMillis() + "@test.com");

        mockMvc.perform(get("/api/workspaces/{workspaceId}/dashboard/usage", auth.workspaceId())
                        .param("groupBy", "operation")
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data.groupBy").value("operation"))
                .andExpect(jsonPath("$.data.items").isArray());
    }
}
