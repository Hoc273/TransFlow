package com.app.modules.platform.security;

import com.app.modules.auth.dto.LoginRequest;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.credit.dto.PurchaseCreditPackageRequest;
import com.app.modules.credit.entity.CreditPackage;
import com.app.modules.credit.repository.CreditPackageRepository;
import com.app.modules.platform.entity.UserActivityLog;
import com.app.modules.platform.repository.UserActivityLogRepository;
import com.app.testsupport.TestRegistration;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class UserActivityLogTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private com.app.modules.auth.service.RegisterOtpStore registerOtpStore;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private CreditPackageRepository creditPackageRepository;
    @Autowired
    private UserActivityLogRepository activityLogRepository;

    private String register(String email) throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore,
                new RegisterRequest(email, "Password123!", "Activity User"));
        MvcResult res = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).path("data").path("accessToken").asText();
    }

    private List<UserActivityLog> logsOf(UUID userId) {
        return activityLogRepository.findAll().stream().filter(a -> userId.equals(a.getUserId())).toList();
    }

    @Test
    void writesAreLoggedPerUserAndReadsAreNot() throws Exception {
        String email = "activity_" + System.nanoTime() + "@test.com";
        String token = register(email);
        UUID userId = userRepository.findByEmailIgnoreCase(email).orElseThrow().getId();

        CreditPackage pkg = new CreditPackage();
        pkg.setName("Activity Pack");
        pkg.setCreditAmount(new BigDecimal("100.0000"));
        pkg.setPriceAmount(new BigDecimal("10000.00"));
        pkg = creditPackageRepository.save(pkg);

        mockMvc.perform(get("/api/users/me/credit").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/credit/packages/" + pkg.getId() + "/purchase")
                        .header("Authorization", "Bearer " + token)
                        .header("User-Agent", "activity-test")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new PurchaseCreditPackageRequest("ACT-" + System.nanoTime()))))
                .andExpect(status().isOk());

        List<UserActivityLog> logs = logsOf(userId);
        assertThat(logs).hasSize(1);
        UserActivityLog row = logs.get(0);
        assertThat(row.getAction()).isEqualTo("POST /api/credit/packages/{id}/purchase");
        assertThat(row.getStatusCode()).isEqualTo(200);
        assertThat(row.getUserAgent()).isEqualTo("activity-test");
    }

    @Test
    void failedLoginIsLoggedWithoutUser() throws Exception {
        long before = activityLogRepository.count();
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("nobody_" + System.nanoTime() + "@test.com", "wrong-password"))))
                .andExpect(status().is4xxClientError());

        assertThat(activityLogRepository.count()).isEqualTo(before + 1);
        assertThat(activityLogRepository.findAll()).anySatisfy(a -> {
            assertThat(a.getUserId()).isNull();
            assertThat(a.getAction()).isEqualTo("POST /api/auth/login");
            assertThat(a.getStatusCode()).isGreaterThanOrEqualTo(400);
        });
    }

    @Test
    void onlySuperAdminCanListActivity() throws Exception {
        String userEmail = "activity_viewer_" + System.nanoTime() + "@test.com";
        String userToken = register(userEmail);
        mockMvc.perform(get("/api/platform/activity-logs").header("Authorization", "Bearer " + userToken))
                .andExpect(status().isForbidden());

        User admin = userRepository.findByEmailIgnoreCase(userEmail).orElseThrow();
        admin.setPlatformAdmin(true);
        userRepository.save(admin);
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest("ghost_list@test.com", "x"))))
                .andExpect(status().is4xxClientError());

        mockMvc.perform(get("/api/platform/activity-logs")
                        .header("Authorization", "Bearer " + userToken)
                        .param("q", "auth/login")
                        .param("failedOnly", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content[0].action").value("POST /api/auth/login"))
                .andExpect(jsonPath("$.data.content[0].userId").doesNotExist());
    }

    @Test
    void highVolumeEndpointsAreSkipped() {
        assertThat(UserActivityLogFilter.isHighVolume("/api/presence/heartbeat")).isTrue();
        assertThat(UserActivityLogFilter.isHighVolume("/api/auth/refresh")).isTrue();
        assertThat(UserActivityLogFilter.isHighVolume("/api/platform/credit/purchases/x/approve")).isTrue();
        assertThat(UserActivityLogFilter.isHighVolume(
                "/api/workspaces/" + UUID.randomUUID() + "/media/uploads/" + UUID.randomUUID() + "/chunks/3")).isTrue();
        assertThat(UserActivityLogFilter.isHighVolume("/api/workspaces/" + UUID.randomUUID() + "/media/jobs")).isFalse();
    }
}
