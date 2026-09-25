package com.app.modules.provider.service.impl;

import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.service.ProviderHealthService;
import com.app.modules.provider.service.ProviderUsageScope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Redis-backed cooldowns for platform pool keys. Fail-open: when Redis is unavailable
 * every key counts as available, which is the behaviour before the pool existed.
 */
@Service
public class ProviderHealthServiceImpl implements ProviderHealthService {

    private static final Logger log = LoggerFactory.getLogger(ProviderHealthServiceImpl.class);

    static final String COOLDOWN_PREFIX = "provider:cooldown:";
    static final String EXCLUDE_PREFIX = "provider:exclude:";
    /** A stage attempt budget is at most 45 min; exclusions only need to outlive the retries. */
    private static final Duration EXCLUDE_TTL = Duration.ofHours(2);

    /** Credentials rejected: the key is taken out of the pool until a health check passes. */
    private static final Set<String> CREDENTIAL_ERRORS = Set.of(
            "PROVIDER_AUTH_FAILED", "PROVIDER_PERMISSION_DENIED", "PROVIDER_ACCOUNT_SUSPENDED");

    /** Provider-side outages and limits: the key cools down, then rejoins the pool. */
    private static final Map<String, Duration> COOLDOWNS = Map.ofEntries(
            Map.entry("PROVIDER_RATE_LIMITED", Duration.ofSeconds(60)),
            Map.entry("PROVIDER_QUOTA_EXCEEDED", Duration.ofMinutes(30)),
            Map.entry("PROVIDER_UNAVAILABLE", Duration.ofMinutes(2)),
            Map.entry("PROVIDER_TIMEOUT", Duration.ofMinutes(2)),
            Map.entry("PROVIDER_NETWORK_ERROR", Duration.ofMinutes(2)),
            Map.entry("PROVIDER_TRANSPORT_ERROR", Duration.ofMinutes(2)),
            Map.entry("PROVIDER_SSL_ERROR", Duration.ofMinutes(10)),
            Map.entry("PROVIDER_INTERNAL_ERROR", Duration.ofMinutes(2)),
            Map.entry("PROVIDER_MODEL_NOT_FOUND", Duration.ofMinutes(30)),
            Map.entry("PROVIDER_UNSUPPORTED_MODEL", Duration.ofMinutes(30)),
            Map.entry("PROVIDER_ENDPOINT_NOT_FOUND", Duration.ofMinutes(30)),
            Map.entry("PROVIDER_INVALID_BASE_URL", Duration.ofMinutes(30)));

    /**
     * Output-quality failures: another (usually stronger) model may succeed, but the key
     * itself is fine, so it is only skipped for the rest of this stage's retries.
     */
    private static final Set<String> QUALITY_ERRORS = Set.of(
            "PROVIDER_RESPONSE_MALFORMED", "PROVIDER_EMPTY_RESPONSE",
            "PROVIDER_OUTPUT_BUSINESS_RULE_VIOLATION", "PROVIDER_CONTEXT_LENGTH_EXCEEDED",
            "PROVIDER_CONTENT_FILTERED", "PROVIDER_UNKNOWN");

    private final StringRedisTemplate redis;
    private final PlatformAiProviderRepository platformRepository;

    public ProviderHealthServiceImpl(StringRedisTemplate redis, PlatformAiProviderRepository platformRepository) {
        this.redis = redis;
        this.platformRepository = platformRepository;
    }

    /** True for error codes where retrying on another pool key can help. */
    public static boolean isFailoverError(String errorCode) {
        return errorCode != null && (CREDENTIAL_ERRORS.contains(errorCode)
                || COOLDOWNS.containsKey(errorCode) || QUALITY_ERRORS.contains(errorCode));
    }

    @Override
    @Transactional
    public boolean reportScopeFailure(String errorCode) {
        Optional<ProviderUsageScope> scope = ProviderUsageScope.current();
        if (scope.isEmpty() || !isFailoverError(errorCode)) {
            return false;
        }
        var resolved = scope.get().resolved();
        if (resolved.isEmpty()) {
            return false;
        }
        // The failing call is the most recent resolution in the attempt.
        ProviderUsageScope.Resolved failed = resolved.get(resolved.size() - 1);
        if (!failed.platform()) {
            return false; // a personal key is never swapped for the shared pool
        }
        exclude(scope.get().key(), failed.providerId());
        if (CREDENTIAL_ERRORS.contains(errorCode)) {
            markDown(failed.providerId(), errorCode);
            cooldown(failed.providerId(), Duration.ofMinutes(30));
        } else if (COOLDOWNS.containsKey(errorCode)) {
            cooldown(failed.providerId(), COOLDOWNS.get(errorCode));
        }
        log.warn("Platform provider {} failed with {} in scope {}; excluded for this stage",
                failed.providerId(), errorCode, scope.get().key());
        return true;
    }

    @Override
    public boolean isCoolingDown(UUID providerId) {
        try {
            return Boolean.TRUE.equals(redis.hasKey(COOLDOWN_PREFIX + providerId));
        } catch (RuntimeException ex) {
            log.debug("Provider cooldown lookup failed; treating key as available: {}", ex.toString());
            return false;
        }
    }

    @Override
    public boolean isExcludedForScope(String scopeKey, UUID providerId) {
        if (scopeKey == null || providerId == null) {
            return false;
        }
        try {
            return Boolean.TRUE.equals(redis.opsForSet().isMember(EXCLUDE_PREFIX + scopeKey, providerId.toString()));
        } catch (RuntimeException ex) {
            log.debug("Provider exclusion lookup failed; treating key as available: {}", ex.toString());
            return false;
        }
    }

    @Override
    @Transactional(readOnly = true)
    public boolean hasPlatformAlternative(String capability) {
        String scopeKey = ProviderUsageScope.current().map(ProviderUsageScope::key).orElse(null);
        return platformRepository.findByIsActiveTrue().stream()
                .filter(p -> p.hasCapability(capability))
                .filter(p -> p.getHealthStatus() != PlatformAiProvider.HealthStatus.DOWN)
                .anyMatch(p -> !isCoolingDown(p.getId()) && !isExcludedForScope(scopeKey, p.getId()));
    }

    private void exclude(String scopeKey, UUID providerId) {
        try {
            String key = EXCLUDE_PREFIX + scopeKey;
            redis.opsForSet().add(key, providerId.toString());
            redis.expire(key, EXCLUDE_TTL);
        } catch (RuntimeException ex) {
            log.warn("Could not record provider exclusion: {}", ex.toString());
        }
    }

    private void cooldown(UUID providerId, Duration duration) {
        try {
            redis.opsForValue().set(COOLDOWN_PREFIX + providerId, Instant.now().toString(), duration);
        } catch (RuntimeException ex) {
            log.warn("Could not record provider cooldown: {}", ex.toString());
        }
    }

    private void markDown(UUID providerId, String errorCode) {
        platformRepository.findById(providerId).ifPresent(p -> {
            p.setHealthStatus(PlatformAiProvider.HealthStatus.DOWN);
            p.setLastErrorCode(errorCode);
            p.setLastCheckedAt(Instant.now());
            platformRepository.save(p);
        });
    }
}
