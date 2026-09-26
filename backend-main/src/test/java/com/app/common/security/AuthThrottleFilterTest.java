package com.app.common.security;

import com.app.common.config.SecurityProperties;
import com.app.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthThrottleFilterTest {

    private final AuthThrottleFilter filter = new AuthThrottleFilter(limiter(),
            new SecurityProperties(false, false, null, null, null,
                    new SecurityProperties.AuthThrottle(2, Duration.ofMinutes(5))),
            new ObjectMapper());

    @Test
    void blocksAnIpAfterBudgetAcrossAuthEndpoints() throws Exception {
        assertEquals(200, run("POST", "/api/auth/login", "10.0.0.1").getStatus());
        assertEquals(200, run("POST", "/api/auth/register/otp", "10.0.0.1").getStatus());

        MockHttpServletResponse blocked = run("POST", "/api/auth/forgot-password/otp", "10.0.0.1");
        assertEquals(429, blocked.getStatus());
        assertEquals("300", blocked.getHeader("Retry-After"));
        assertTrue(blocked.getContentAsString().contains(String.valueOf(ErrorCode.TOO_MANY_REQUESTS.getCode())));

        // Other IPs keep their own budget.
        assertEquals(200, run("POST", "/api/auth/login", "10.0.0.2").getStatus());
    }

    @Test
    void ignoresRefreshLogoutGetsAndNonAuthPaths() throws Exception {
        for (int i = 0; i < 5; i++) {
            assertEquals(200, run("POST", "/api/auth/refresh", "10.0.0.9").getStatus());
            assertEquals(200, run("POST", "/api/auth/logout", "10.0.0.9").getStatus());
            assertEquals(200, run("GET", "/api/auth/google/start", "10.0.0.9").getStatus());
            assertEquals(200, run("POST", "/api/projects", "10.0.0.9").getStatus());
        }
    }

    private MockHttpServletResponse run(String method, String uri, String ip) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest(method, uri);
        req.setRemoteAddr(ip);
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.doFilter(req, res, new MockFilterChain());
        return res;
    }

    private static FixedWindowRateLimiter limiter() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.opsForValue()).thenThrow(new RedisConnectionFailureException("down"));
        return new FixedWindowRateLimiter(redis);
    }
}
