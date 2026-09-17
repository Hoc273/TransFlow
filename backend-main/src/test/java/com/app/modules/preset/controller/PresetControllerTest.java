package com.app.modules.preset.controller;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.preset.dto.CreateMediaPresetRequest;
import com.app.modules.preset.dto.UpdateMediaPresetRequest;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class PresetControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private record AuthContext(String token, UUID workspaceId, UUID projectId) {}

    private AuthContext registerUser(String email) throws Exception {
        RegisterRequest req = new RegisterRequest(email, "Password123!", "Preset Test User");
        MvcResult res = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode data = objectMapper.readTree(res.getResponse().getContentAsString()).path("data");
        String token = data.path("accessToken").asText();
        UUID wsId = UUID.fromString(data.path("workspaceId").asText());
        UUID pId = UUID.fromString(data.path("projectId").asText());
        return new AuthContext(token, wsId, pId);
    }

    @Test
    @DisplayName("Public templates catalog returns 200 with code 1000")
    void getTemplates_returnsSuccess() throws Exception {
        AuthContext auth = registerUser("template_user_" + System.currentTimeMillis() + "@test.com");

        mockMvc.perform(get("/api/media/presets/templates")
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data").isArray());
    }

    @Test
    @DisplayName("Preset full lifecycle: create, get, list, update, delete with replacement")
    void presetFullLifecycle() throws Exception {
        AuthContext auth = registerUser("preset_crud_" + System.currentTimeMillis() + "@test.com");

        // 1. Create a WORKSPACE preset (default)
        CreateMediaPresetRequest create1 = new CreateMediaPresetRequest(
                "WORKSPACE",
                null,
                "WS Default Preset",
                objectMapper.readTree("{\"fontFamily\":\"Inter\",\"fontSize\":24}"),
                objectMapper.readTree("{\"stability\":0.8}"),
                objectMapper.readTree("{\"outputAspectRatio\":\"16:9\"}"),
                true
        );

        MvcResult createRes1 = mockMvc.perform(post("/api/workspaces/{workspaceId}/presets", auth.workspaceId())
                        .header("Authorization", "Bearer " + auth.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(create1)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data.name").value("WS Default Preset"))
                .andExpect(jsonPath("$.data.isDefault").value(true))
                .andReturn();

        UUID preset1Id = UUID.fromString(
                objectMapper.readTree(createRes1.getResponse().getContentAsString()).path("data").path("id").asText()
        );

        // 2. Create a second WORKSPACE preset (non-default)
        CreateMediaPresetRequest create2 = new CreateMediaPresetRequest(
                "WORKSPACE",
                null,
                "WS Secondary Preset",
                objectMapper.readTree("{\"fontFamily\":\"Roboto\",\"fontSize\":20}"),
                objectMapper.readTree("{}"),
                objectMapper.readTree("{}"),
                false
        );

        MvcResult createRes2 = mockMvc.perform(post("/api/workspaces/{workspaceId}/presets", auth.workspaceId())
                        .header("Authorization", "Bearer " + auth.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(create2)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.isDefault").value(false))
                .andReturn();

        UUID preset2Id = UUID.fromString(
                objectMapper.readTree(createRes2.getResponse().getContentAsString()).path("data").path("id").asText()
        );

        // 3. Get preset by id
        mockMvc.perform(get("/api/workspaces/{workspaceId}/presets/{presetId}", auth.workspaceId(), preset1Id)
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data.id").value(preset1Id.toString()))
                .andExpect(jsonPath("$.data.name").value("WS Default Preset"));

        // 4. List presets in workspace
        mockMvc.perform(get("/api/workspaces/{workspaceId}/presets", auth.workspaceId())
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data").isArray());

        // 5. Update preset2
        UpdateMediaPresetRequest updateReq = new UpdateMediaPresetRequest(
                "WS Secondary Updated",
                null,
                null,
                null,
                null,
                true
        );

        mockMvc.perform(put("/api/workspaces/{workspaceId}/presets/{presetId}", auth.workspaceId(), preset2Id)
                        .header("Authorization", "Bearer " + auth.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.SUCCESS.getCode()))
                .andExpect(jsonPath("$.data.name").value("WS Secondary Updated"));

        // 6. Delete default preset1 without replacement -> fails with 400 CANNOT_DELETE_ONLY_DEFAULT_PRESET (code 2503)
        mockMvc.perform(delete("/api/workspaces/{workspaceId}/presets/{presetId}", auth.workspaceId(), preset1Id)
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.CANNOT_DELETE_ONLY_DEFAULT_PRESET.getCode()));

        // 7. Delete default preset1 with replacement preset2 -> 204 No Content
        mockMvc.perform(delete("/api/workspaces/{workspaceId}/presets/{presetId}?replacementPresetId=" + preset2Id, auth.workspaceId(), preset1Id)
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isNoContent());

        // 8. Verify preset2 is now default
        mockMvc.perform(get("/api/workspaces/{workspaceId}/presets/{presetId}", auth.workspaceId(), preset2Id)
                        .header("Authorization", "Bearer " + auth.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.isDefault").value(true));
    }
}
