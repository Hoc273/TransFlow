package com.app.common.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.Base64;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SecretsStartupValidatorTest {

    private static final String STRONG = Base64.getEncoder().encodeToString("s".repeat(48).getBytes());

    @Test
    void devDefaultsAreReportedAndStrictModeRefusesToStart() {
        AppProperties app = new AppProperties(null, null, null, null, null,
                new AppProperties.Storage(null, "minioadmin", "minioadmin", null),
                new AppProperties.MediaWorker(null, null, null),
                null, null, null);
        MockEnvironment env = new MockEnvironment()
                .withProperty("spring.datasource.password", "postgres")
                .withProperty("spring.rabbitmq.password", "transflow");

        SecretsStartupValidator lenient = new SecretsStartupValidator(app, security(false, null), env);
        assertEquals(List.of("JWT_SECRET", "PROVIDER_KEY_ENC_SECRET", "MEDIA_WORKER_CALLBACK_SECRET",
                "INTERNAL_SERVICE_TOKEN", "MEDIA_STORAGE_SECRET_KEY", "DB_PASSWORD", "RABBITMQ_PASSWORD"),
                lenient.findProblems());
        assertDoesNotThrow(lenient::validate);

        SecretsStartupValidator strict = new SecretsStartupValidator(app, security(true, null), env);
        IllegalStateException ex = assertThrows(IllegalStateException.class, strict::validate);
        assertFalse(ex.getMessage().contains("minioadmin"), "secret values must never be echoed");
    }

    @Test
    void strongSecretsPassStrictMode() {
        AppProperties app = new AppProperties(null,
                new AppProperties.Jwt(STRONG, 30, 14, "transflow"),
                null, null, null,
                new AppProperties.Storage(null, "tf-media", "x".repeat(40), null),
                new AppProperties.MediaWorker(null, null, "h".repeat(40)),
                new AppProperties.Crypto(STRONG), null, null);
        MockEnvironment env = new MockEnvironment()
                .withProperty("spring.datasource.password", "db-" + "p".repeat(20))
                .withProperty("spring.rabbitmq.password", "mq-" + "p".repeat(20));

        SecretsStartupValidator strict = new SecretsStartupValidator(app, security(true, "t".repeat(40)), env);
        assertEquals(List.of(), strict.findProblems());
        assertDoesNotThrow(strict::validate);
    }

    private static SecurityProperties security(boolean strict, String internalToken) {
        return new SecurityProperties(strict, false, internalToken, null, null, null);
    }
}
