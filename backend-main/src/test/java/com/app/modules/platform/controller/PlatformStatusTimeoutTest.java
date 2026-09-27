package com.app.modules.platform.controller;

import com.app.common.security.AuthenticatedUser;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.entity.UserStatus;
import com.app.modules.auth.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import io.minio.BucketExistsArgs;
import io.minio.MinioClient;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Regression test for the status-probe timeout fix: a hung probe must not block
 * the response past the wait budget, and the timed-out service keeps its real
 * {@code id}/{@code name} (no "unknown" placeholder).
 */
@SpringBootTest
@AutoConfigureMockMvc
class PlatformStatusTimeoutTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @MockBean
    private MinioClient minioClient;

    private User adminUser;

    @BeforeEach
    void setup() {
        userRepository.deleteAll();

        adminUser = new User();
        adminUser.setEmail("admin@transflow.com");
        adminUser.setFullName("Super Admin");
        adminUser.setPasswordHash("hashed");
        adminUser.setStatus(UserStatus.ACTIVE);
        adminUser.setPlatformAdmin(true);
        adminUser = userRepository.save(adminUser);
    }

    @Test
    void testStatus_HungProbeKeepsIdentityAndTimesOut() throws Exception {
        // Simulate a socket-level hang far beyond the 8s probe budget.
        when(minioClient.bucketExists(org.mockito.ArgumentMatchers.any(BucketExistsArgs.class)))
                .thenAnswer(invocation -> {
                    Thread.sleep(30_000);
                    throw new RuntimeException("unreachable");
                });

        AuthenticatedUser authUser = new AuthenticatedUser(adminUser.getId(), adminUser.getEmail());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(authUser, null, Collections.emptyList()));

        long start = System.currentTimeMillis();
        mockMvc.perform(get("/api/platform/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.overall").value("DEGRADED"))
                .andExpect(jsonPath("$.data.services.length()").value(6))
                // Identity preserved — the hung probe still reports as "minio".
                .andExpect(jsonPath("$.data.services[3].id").value("minio"))
                .andExpect(jsonPath("$.data.services[3].status").value("DOWN"))
                .andExpect(jsonPath("$.data.services[3].message").value("probe timed out"));
        long elapsed = System.currentTimeMillis() - start;

        // Must return near the 8s budget — never anywhere near the 30s hang.
        org.assertj.core.api.Assertions.assertThat(elapsed).isLessThan(20_000);
    }
}
