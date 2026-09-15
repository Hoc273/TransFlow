package com.app.modules.auth.service.oauth;

import com.app.common.config.AppProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Redis-backed one-time OAuth state (CSRF + PKCE) and FE exchange codes,
 * with an in-memory fallback for resilience if Redis is unavailable.
 */
@Component
public class GoogleOAuthSessionStore {

    private static final Logger log = LoggerFactory.getLogger(GoogleOAuthSessionStore.class);

    private static final String STATE_KEY = "oauth:google:state:";
    private static final String EXCHANGE_KEY = "oauth:google:exchange:";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Duration stateTtl;
    private final Duration exchangeTtl;

    // In-memory fallback
    private final Map<String, StateEntry> fallbackStates = new ConcurrentHashMap<>();
    private final Map<String, ExchangeEntry> fallbackExchanges = new ConcurrentHashMap<>();

    public GoogleOAuthSessionStore(StringRedisTemplate redis,
                                   ObjectMapper objectMapper,
                                   AppProperties props) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        AppProperties.Oauth.Google g = props.oauth().google();
        long stateMinutes = Math.min(Math.max(g.stateTtlMinutes(), 1), 10);
        this.stateTtl = Duration.ofMinutes(stateMinutes);
        this.exchangeTtl = Duration.ofSeconds(Math.max(g.exchangeTtlSeconds(), 30));
    }

    public void saveState(String state, OAuthPendingSession session) {
        try {
            redis.opsForValue().set(STATE_KEY + state, objectMapper.writeValueAsString(session), stateTtl);
            return;
        } catch (Exception ex) {
            log.debug("Redis not available for OAuth saveState, using in-memory store: {}", ex.getMessage());
        }

        fallbackStates.put(state, new StateEntry(session, Instant.now().plus(stateTtl)));
    }

    public Optional<OAuthPendingSession> consumeState(String state) {
        if (state == null || state.isBlank()) {
            return Optional.empty();
        }
        String key = STATE_KEY + state;
        try {
            String json = redis.opsForValue().getAndDelete(key);
            if (json != null && !json.isBlank()) {
                return Optional.of(objectMapper.readValue(json, OAuthPendingSession.class));
            }
        } catch (Exception ex) {
            log.debug("Redis getAndDelete failed, checking fallback: {}", ex.getMessage());
        }

        StateEntry entry = fallbackStates.remove(state);
        if (entry != null && entry.expiresAt().isAfter(Instant.now())) {
            return Optional.of(entry.session());
        }
        return Optional.empty();
    }

    public String createExchangeCode(UUID userId) {
        String code = UUID.randomUUID().toString().replace("-", "")
                + UUID.randomUUID().toString().replace("-", "");
        try {
            redis.opsForValue().set(EXCHANGE_KEY + code, userId.toString(), exchangeTtl);
            return code;
        } catch (Exception ex) {
            log.debug("Redis not available for createExchangeCode, using fallback: {}", ex.getMessage());
        }

        fallbackExchanges.put(code, new ExchangeEntry(userId, Instant.now().plus(exchangeTtl)));
        return code;
    }

    public Optional<UUID> consumeExchangeCode(String code) {
        if (code == null || code.isBlank()) {
            return Optional.empty();
        }
        try {
            String raw = redis.opsForValue().getAndDelete(EXCHANGE_KEY + code);
            if (raw != null && !raw.isBlank()) {
                return Optional.of(UUID.fromString(raw));
            }
        } catch (Exception ex) {
            log.debug("Redis getAndDelete failed for exchange code, checking fallback: {}", ex.getMessage());
        }

        ExchangeEntry entry = fallbackExchanges.remove(code);
        if (entry != null && entry.expiresAt().isAfter(Instant.now())) {
            return Optional.of(entry.userId());
        }
        return Optional.empty();
    }

    public record OAuthPendingSession(
            String codeVerifier,
            String mode,
            String redirect
    ) {
    }

    private record StateEntry(OAuthPendingSession session, Instant expiresAt) {}
    private record ExchangeEntry(UUID userId, Instant expiresAt) {}
}
