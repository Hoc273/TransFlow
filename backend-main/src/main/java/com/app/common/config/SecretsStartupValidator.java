package com.app.common.config;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Set;

/**
 * Refuses to run a production deployment on the dev fallbacks baked into application.yaml
 * (public in git: anyone could forge JWTs, decrypt BYOK keys, or forge worker callbacks).
 * {@code app.security.strict-secrets=true} (env {@code STRICT_SECRETS}) turns warnings into a
 * startup failure. Only the setting NAME is ever logged, never a value.
 */
@Component
public class SecretsStartupValidator {

    private static final Logger log = LoggerFactory.getLogger(SecretsStartupValidator.class);

    static final String DEV_JWT_SECRET = "ZGV2LW9ubHktc2VjcmV0LWNoYW5nZS1tZS0zMi1ieXRlcy1sb25nISE=";
    static final String DEV_PROVIDER_KEY_SECRET = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=";
    private static final Set<String> PLACEHOLDERS = Set.of(
            "change-me", "change_me", "changeme", "minioadmin", "postgres", "transflow", "secret", "password");
    private static final int MIN_SECRET_BYTES = 32;

    private final AppProperties app;
    private final SecurityProperties security;
    private final Environment env;

    public SecretsStartupValidator(AppProperties app, SecurityProperties security, Environment env) {
        this.app = app;
        this.security = security;
        this.env = env;
    }

    /** Runs during context refresh, i.e. before the web server accepts any request. */
    @PostConstruct
    public void validate() {
        List<String> problems = findProblems();
        if (problems.isEmpty()) {
            return;
        }
        String summary = "Weak or default secrets configured: " + String.join(", ", problems);
        if (security.strictSecrets()) {
            throw new IllegalStateException(summary + " — set real values (see .env.example) or unset STRICT_SECRETS.");
        }
        log.warn("{} — acceptable for local dev only; production must set STRICT_SECRETS=true.", summary);
    }

    List<String> findProblems() {
        List<String> problems = new ArrayList<>();
        if (DEV_JWT_SECRET.equals(app.jwt().secret()) || decodedLength(app.jwt().secret()) < MIN_SECRET_BYTES) {
            problems.add("JWT_SECRET");
        }
        if (DEV_PROVIDER_KEY_SECRET.equals(app.crypto().providerKeySecret())) {
            problems.add("PROVIDER_KEY_ENC_SECRET");
        }
        if (isWeak(app.mediaWorker().hmacSecret())) {
            problems.add("MEDIA_WORKER_CALLBACK_SECRET");
        }
        if (isWeak(security.internalServiceToken())) {
            problems.add("INTERNAL_SERVICE_TOKEN");
        }
        if (app.storage() != null && isPlaceholder(app.storage().secretKey())) {
            problems.add("MEDIA_STORAGE_SECRET_KEY");
        }
        if (isPlaceholder(env.getProperty("spring.datasource.password"))) {
            problems.add("DB_PASSWORD");
        }
        if (isPlaceholder(env.getProperty("spring.rabbitmq.password"))) {
            problems.add("RABBITMQ_PASSWORD");
        }
        return problems;
    }

    private static boolean isWeak(String secret) {
        return secret == null || secret.isBlank() || isPlaceholder(secret) || secret.length() < MIN_SECRET_BYTES;
    }

    private static boolean isPlaceholder(String value) {
        return value == null || value.isBlank() || PLACEHOLDERS.contains(value.trim().toLowerCase());
    }

    private static int decodedLength(String base64) {
        try {
            return Base64.getDecoder().decode(base64).length;
        } catch (IllegalArgumentException ex) {
            return 0;
        }
    }
}
