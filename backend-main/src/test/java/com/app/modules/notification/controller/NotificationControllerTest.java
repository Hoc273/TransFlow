package com.app.modules.notification.controller;

import com.app.testsupport.TestRegistration;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.notification.service.NotificationService;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class NotificationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private com.app.modules.auth.service.RegisterOtpStore registerOtpStore;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private NotificationService notificationService;

    private record AuthContext(String token, UUID userId, UUID workspaceId, UUID projectId) {}

    private AuthContext registerUser(String email) throws Exception {
        RegisterRequest req = TestRegistration.withOtp(registerOtpStore, new RegisterRequest(email, "Password123!", "Notification Test User"));
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
    @DisplayName("GET /api/workspaces/{workspaceId}/notifications lists notifications for current user")
    void listNotifications_success() throws Exception {
        AuthContext auth = registerUser("notif_list_" + System.currentTimeMillis() + "@test.com");
        UUID refId = UUID.randomUUID();

        notificationService.notify(auth.workspaceId(), auth.userId(), "JOB_COMPLETED", refId, "Job 1 complete");

        mockMvc.perform(get("/api/workspaces/{workspaceId}/notifications", auth.workspaceId())
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data.items").isArray())
                .andExpect(jsonPath("$.data.items[0].message").value("Job 1 complete"))
                .andExpect(jsonPath("$.data.items[0].type").value("JOB_COMPLETED"));
    }

    @Test
    @DisplayName("POST /api/workspaces/{workspaceId}/notifications/{id}/read marks notification as read")
    void markAsRead_success() throws Exception {
        AuthContext auth = registerUser("notif_read_" + System.currentTimeMillis() + "@test.com");
        UUID refId = UUID.randomUUID();

        notificationService.notify(auth.workspaceId(), auth.userId(), "JOB_FAILED", refId, "Job failed");

        MvcResult listRes = mockMvc.perform(get("/api/workspaces/{workspaceId}/notifications", auth.workspaceId())
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode items = objectMapper.readTree(listRes.getResponse().getContentAsString())
                .path("data").path("items");
        assertThat(items.isArray()).isTrue();
        assertThat(items.size()).isGreaterThan(0);
        String notifId = items.get(0).path("id").asText();

        mockMvc.perform(post("/api/workspaces/{workspaceId}/notifications/{id}/read", auth.workspaceId(), notifId)
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data.readAt").isNotEmpty());
    }

    @Test
    @DisplayName("POST /api/workspaces/{workspaceId}/notifications/read-all marks all as read")
    void markAllAsRead_success() throws Exception {
        AuthContext auth = registerUser("notif_readall_" + System.currentTimeMillis() + "@test.com");

        notificationService.notify(auth.workspaceId(), auth.userId(), "BATCH_COMPLETED", UUID.randomUUID(), "Batch done");
        notificationService.notify(auth.workspaceId(), auth.userId(), "JOB_NEEDS_RERUN", UUID.randomUUID(), "Rerun needed");

        mockMvc.perform(post("/api/workspaces/{workspaceId}/notifications/read-all", auth.workspaceId())
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data.updatedCount").isNumber());
    }
}
