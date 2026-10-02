package com.app.modules.platform.security;

import com.app.modules.auth.dto.LoginRequest;
import com.app.modules.platform.repository.UserActivityLogRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Logins stopped by the auth throttle never reach the controller, yet must still be logged. */
@SpringBootTest(properties = "app.security.auth-throttle.max-requests=2")
@AutoConfigureMockMvc
class UserActivityLogThrottleTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private UserActivityLogRepository activityLogRepository;

    @Test
    void rateLimitedLoginsAreLogged() throws Exception {
        String body = objectMapper.writeValueAsString(new LoginRequest("brute@test.com", "guess"));
        for (int i = 0; i < 3; i++) {
            var result = mockMvc.perform(post("/api/auth/login")
                    .with(request -> {
                        request.setRemoteAddr("203.0.113.77");
                        return request;
                    })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body));
            if (i == 2) {
                result.andExpect(status().isTooManyRequests());
            }
        }

        assertThat(activityLogRepository.findAll())
                .filteredOn(a -> "203.0.113.77".equals(a.getIp()))
                .extracting(a -> a.getStatusCode())
                .hasSize(3)
                .contains(429);
    }
}
