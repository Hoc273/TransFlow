package com.app.modules.transformation.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class TransformationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void testGetCapabilities_Success() throws Exception {
        mockMvc.perform(get("/api/transformation/capabilities"))
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
}
