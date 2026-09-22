package com.app.modules.transformation.controller;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.transformation.dto.AvailabilityProjection;
import com.app.modules.transformation.dto.ModeAvailability;
import com.app.modules.transformation.dto.ReadinessSummary;
import com.app.modules.transformation.dto.WorkerCapabilitySummary;
import com.app.modules.transformation.service.WorkerCapabilityService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class TransformationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private WorkerCapabilityService workerCapabilityService;

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
    void testGetCapabilities_Success() throws Exception {
        String token = registerAndGetToken(
                "cap_" + System.currentTimeMillis() + "@test.com", "Cap User");

        when(workerCapabilityService.getCapabilities()).thenReturn(new AvailabilityProjection(
                "1.0",
                List.of("FAST", "STUDIO"),
                "FAST",
                Map.of(
                        "FAST", new ModeAvailability(true, null),
                        "STUDIO", new ModeAvailability(true, null)),
                new WorkerCapabilitySummary("READY", 1, 1, 1),
                new ReadinessSummary("READY", List.of("FAST", "STUDIO"), List.of(),
                        Instant.now().toString())));

        mockMvc.perform(get("/api/transformation/capabilities")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.protocolVersion").value("1.0"))
                .andExpect(jsonPath("$.data.supportedExecutionModes[0]").value("FAST"))
                .andExpect(jsonPath("$.data.supportedExecutionModes[1]").value("STUDIO"))
                .andExpect(jsonPath("$.data.defaultExecutionMode").value("FAST"))
                .andExpect(jsonPath("$.data.availability.FAST.available").value(true))
                .andExpect(jsonPath("$.data.availability.STUDIO.available").value(true))
                .andExpect(jsonPath("$.data.workerCapability.state").value("READY"))
                .andExpect(jsonPath("$.data.workerCapability.workerCount").value(1))
                .andExpect(jsonPath("$.data.readiness.status").value("READY"));
    }

    @Test
    void testGetCapabilities_UnauthenticatedReturns401() throws Exception {
        mockMvc.perform(get("/api/transformation/capabilities"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHENTICATED.getCode()));
    }
}
