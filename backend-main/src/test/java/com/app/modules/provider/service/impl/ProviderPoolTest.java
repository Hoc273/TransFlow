package com.app.modules.provider.service.impl;

import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.service.ProviderUsageScope;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** Platform key pool: selection order, fallback and failure reporting. */
@ExtendWith(MockitoExtension.class)
class ProviderPoolTest {

    @Mock
    private StringRedisTemplate redis;
    @Mock
    private ValueOperations<String, String> valueOps;
    @Mock
    private SetOperations<String, String> setOps;
    @Mock
    private PlatformAiProviderRepository platformRepository;

    private static PlatformAiProvider key(String name, int priority, int weight,
                                          PlatformAiProvider.HealthStatus health) {
        PlatformAiProvider p = new PlatformAiProvider();
        p.setId(UUID.randomUUID());
        p.setName(name);
        p.setProtocol("openai_compatible");
        p.setCapabilities(List.of("TRANSLATE"));
        p.setPriority((short) priority);
        p.setWeight((short) weight);
        p.setHealthStatus(health);
        p.setCreatedAt(Instant.parse("2026-01-01T00:00:00Z"));
        return p;
    }

    @Test
    void lowestPriorityGroupWins() {
        PlatformAiProvider free = key("freellmapi", 10, 1, PlatformAiProvider.HealthStatus.HEALTHY);
        PlatformAiProvider paid = key("openai", 100, 1, PlatformAiProvider.HealthStatus.HEALTHY);

        Optional<PlatformAiProvider> picked = ProviderResolverServiceImpl.selectPlatform(
                List.of(paid, free), p -> true, bound -> 0);

        assertEquals(free, picked.orElseThrow());
    }

    @Test
    void unavailableKeyFallsThroughToNextPriority() {
        PlatformAiProvider free = key("freellmapi", 10, 1, PlatformAiProvider.HealthStatus.HEALTHY);
        PlatformAiProvider paid = key("openai", 100, 1, PlatformAiProvider.HealthStatus.HEALTHY);

        Optional<PlatformAiProvider> picked = ProviderResolverServiceImpl.selectPlatform(
                List.of(free, paid), p -> p != free, bound -> 0);

        assertEquals(paid, picked.orElseThrow());
    }

    @Test
    void weightSplitsTrafficInsideAGroup() {
        PlatformAiProvider a = key("a", 50, 3, PlatformAiProvider.HealthStatus.HEALTHY);
        PlatformAiProvider b = key("b", 50, 1, PlatformAiProvider.HealthStatus.HEALTHY);

        // total weight 4: draws 0..2 land on a, draw 3 lands on b
        assertEquals(a, ProviderResolverServiceImpl.selectPlatform(List.of(a, b), p -> true, bound -> 2).orElseThrow());
        assertEquals(b, ProviderResolverServiceImpl.selectPlatform(List.of(a, b), p -> true, bound -> 3).orElseThrow());
    }

    @Test
    void noAvailableKeyStillReturnsBestRankedNonDownKey() {
        PlatformAiProvider down = key("down", 1, 1, PlatformAiProvider.HealthStatus.DOWN);
        PlatformAiProvider cooling = key("cooling", 100, 1, PlatformAiProvider.HealthStatus.HEALTHY);

        Optional<PlatformAiProvider> picked = ProviderResolverServiceImpl.selectPlatform(
                List.of(down, cooling), p -> false, bound -> 0);

        assertEquals(cooling, picked.orElseThrow());
    }

    @Test
    void emptyPoolSelectsNothing() {
        assertTrue(ProviderResolverServiceImpl.selectPlatform(List.of(), p -> true, bound -> 0).isEmpty());
    }

    @Test
    void rateLimitCoolsDownAndExcludesTheLastPlatformKey() {
        when(redis.opsForValue()).thenReturn(valueOps);
        when(redis.opsForSet()).thenReturn(setOps);
        ProviderHealthServiceImpl health = new ProviderHealthServiceImpl(redis, platformRepository);
        UUID keyId = UUID.randomUUID();

        try (ProviderUsageScope ignored = ProviderUsageScope.open("stage-1")) {
            ProviderUsageScope.recordResolution("TRANSLATE", keyId, true);
            assertTrue(health.reportScopeFailure("PROVIDER_RATE_LIMITED"));
        }

        verify(setOps).add("provider:exclude:stage-1", keyId.toString());
        verify(valueOps).set(eq("provider:cooldown:" + keyId), anyString(), eq(Duration.ofSeconds(60)));
        verify(platformRepository, never()).save(any());
    }

    @Test
    void rejectedCredentialsMarkTheKeyDown() {
        when(redis.opsForValue()).thenReturn(valueOps);
        when(redis.opsForSet()).thenReturn(setOps);
        ProviderHealthServiceImpl health = new ProviderHealthServiceImpl(redis, platformRepository);
        PlatformAiProvider stored = key("openai", 100, 1, PlatformAiProvider.HealthStatus.HEALTHY);
        when(platformRepository.findById(stored.getId())).thenReturn(Optional.of(stored));

        try (ProviderUsageScope ignored = ProviderUsageScope.open("stage-2")) {
            ProviderUsageScope.recordResolution("TRANSLATE", stored.getId(), true);
            assertTrue(health.reportScopeFailure("PROVIDER_AUTH_FAILED"));
        }

        assertEquals(PlatformAiProvider.HealthStatus.DOWN, stored.getHealthStatus());
        assertEquals("PROVIDER_AUTH_FAILED", stored.getLastErrorCode());
        verify(platformRepository).save(stored);
    }

    @Test
    void personalKeyFailureNeverFailsOverToThePool() {
        ProviderHealthServiceImpl health = new ProviderHealthServiceImpl(redis, platformRepository);

        try (ProviderUsageScope ignored = ProviderUsageScope.open("stage-3")) {
            ProviderUsageScope.recordResolution("TRANSLATE", UUID.randomUUID(), false);
            assertFalse(health.reportScopeFailure("PROVIDER_RATE_LIMITED"));
        }
        verifyNoInteractions(redis);
    }

    @Test
    void nonProviderErrorsAreNotFailoverWorthy() {
        ProviderHealthServiceImpl health = new ProviderHealthServiceImpl(redis, platformRepository);

        try (ProviderUsageScope ignored = ProviderUsageScope.open("stage-4")) {
            ProviderUsageScope.recordResolution("TRANSLATE", UUID.randomUUID(), true);
            assertFalse(health.reportScopeFailure("TTS_SEGMENTS_MISSING"));
            assertFalse(health.reportScopeFailure(null));
        }
        assertFalse(health.reportScopeFailure("PROVIDER_RATE_LIMITED")); // outside any scope
        verifyNoInteractions(redis);
    }

    @Test
    void alternativeIgnoresDownCoolingAndExcludedKeys() {
        when(redis.opsForSet()).thenReturn(setOps);
        ProviderHealthServiceImpl health = new ProviderHealthServiceImpl(redis, platformRepository);
        PlatformAiProvider down = key("down", 1, 1, PlatformAiProvider.HealthStatus.DOWN);
        PlatformAiProvider excluded = key("excluded", 10, 1, PlatformAiProvider.HealthStatus.HEALTHY);
        excluded.setActive(true);
        when(platformRepository.findByIsActiveTrue()).thenReturn(List.of(down, excluded));
        when(redis.hasKey(anyString())).thenReturn(false);
        when(setOps.isMember("provider:exclude:stage-5", excluded.getId().toString())).thenReturn(true);

        try (ProviderUsageScope ignored = ProviderUsageScope.open("stage-5")) {
            assertFalse(health.hasPlatformAlternative("TRANSLATE"));
        }
    }

    @Test
    void failoverClassification() {
        for (String code : Set.of("PROVIDER_RATE_LIMITED", "PROVIDER_QUOTA_EXCEEDED", "PROVIDER_AUTH_FAILED",
                "PROVIDER_RESPONSE_MALFORMED", "PROVIDER_TIMEOUT")) {
            assertTrue(ProviderHealthServiceImpl.isFailoverError(code), code);
        }
        assertFalse(ProviderHealthServiceImpl.isFailoverError("PROVIDER_BAD_REQUEST"));
        assertFalse(ProviderHealthServiceImpl.isFailoverError("MEDIA_FILE_EXPIRED"));
    }
}
