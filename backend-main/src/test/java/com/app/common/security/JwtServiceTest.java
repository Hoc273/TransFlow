package com.app.common.security;

import com.app.common.config.AppProperties;
import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class JwtServiceTest {

    private JwtService jwtService;

    @BeforeEach
    void setUp() {
        AppProperties props = new AppProperties(
                new AppProperties.Cors("http://localhost:5173"),
                new AppProperties.Jwt("ZGV2LW9ubHktc2VjcmV0LWNoYW5nZS1tZS0zMi1ieXRlcy1sb25nISE=", 30, 14, "transflow-test"),
                "http://localhost:5173",
                new AppProperties.Oauth(new AppProperties.Oauth.Google("client", "secret", "http://redirect", null, null, 10, 120)),
                new AppProperties.Credit(new BigDecimal("100.0")),
                new AppProperties.Storage("http://localhost:9000", "minioadmin", "minioadmin", "transflow-media"),
                null
        );
        jwtService = new JwtService(props);
    }

    @Test
    void testAccessTokenLifecycle() {
        UUID userId = UUID.randomUUID();
        String email = "test@transflow.com";

        String token = jwtService.generateAccessToken(userId, email);
        assertNotNull(token);

        Claims claims = jwtService.parse(token);
        assertEquals(userId.toString(), claims.getSubject());
        assertEquals(email, claims.get("email", String.class));
        assertTrue(jwtService.isAccessToken(claims));
        assertFalse(jwtService.isRefreshToken(claims));
    }

    @Test
    void testRefreshTokenLifecycle() {
        UUID userId = UUID.randomUUID();

        String token = jwtService.generateRefreshToken(userId);
        assertNotNull(token);

        Claims claims = jwtService.parse(token);
        assertEquals(userId.toString(), claims.getSubject());
        assertTrue(jwtService.isRefreshToken(claims));
        assertFalse(jwtService.isAccessToken(claims));
    }
}
