package com.app.modules.transformation.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.health.HealthResult;
import com.app.common.health.ServiceHealthProbe;
import com.app.modules.transformation.dto.AvailabilityProjection;
import com.app.modules.transformation.dto.ModeAvailability;
import com.app.modules.transformation.dto.ReadinessSummary;
import com.app.modules.transformation.dto.WorkerCapabilitySummary;
import com.app.modules.transformation.service.WorkerCapabilityService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Simplified availability projection (transflow_mini's answer to transflow's CT10 stack —
 * no scoring/selection engines). Rules (BACKEND_MISSING_TASKS §10):
 * <ul>
 *   <li>{@code FAST} available iff backend-ai AND media-worker are healthy.</li>
 *   <li>{@code STUDIO} available iff FAST is available AND backend-ai reports a configured
 *       source-separation engine ({@code separation.engine} in its /health body).</li>
 *   <li>{@code state}: both up = READY, one up = DEGRADED, none = OFFLINE.</li>
 * </ul>
 * The projection is cached in memory for {@code app.transformation.capabilities-cache-ttl-seconds}
 * so FE polling does not fan out to the workers on every request.
 */
@Service
public class WorkerCapabilityServiceImpl implements WorkerCapabilityService {

    private static final String PROTOCOL_VERSION = "1.0";
    private static final String MODE_FAST = "FAST";
    private static final String MODE_STUDIO = "STUDIO";
    private static final List<String> SUPPORTED_MODES = List.of(MODE_FAST, MODE_STUDIO);

    private static final String REASON_AI_GATEWAY_DOWN = "AI_GATEWAY_DOWN";
    private static final String REASON_MEDIA_WORKER_DOWN = "MEDIA_WORKER_DOWN";
    private static final String REASON_SEPARATION_DISABLED = "SEPARATION_DISABLED";

    private final ServiceHealthProbe healthProbe;
    private final String aiBaseUrl;
    private final String mediaWorkerBaseUrl;
    private final Duration cacheTtl;
    private final AtomicReference<CachedProjection> cache = new AtomicReference<>();

    public WorkerCapabilityServiceImpl(
            AppProperties props,
            ServiceHealthProbe healthProbe,
            @Value("${app.media-worker.base-url:http://localhost:8001}") String mediaWorkerBaseUrl,
            @Value("${app.transformation.capabilities-cache-ttl-seconds:5}") long cacheTtlSeconds) {
        this.healthProbe = healthProbe;
        this.aiBaseUrl = props.ai().baseUrl();
        this.mediaWorkerBaseUrl = mediaWorkerBaseUrl;
        this.cacheTtl = Duration.ofSeconds(Math.max(0, cacheTtlSeconds));
    }

    @Override
    public AvailabilityProjection getCapabilities() {
        Instant now = Instant.now();
        CachedProjection cached = cache.get();
        if (cached != null && now.isBefore(cached.expiresAt())) {
            return cached.projection();
        }
        synchronized (cache) {
            now = Instant.now();
            cached = cache.get();
            if (cached != null && now.isBefore(cached.expiresAt())) {
                return cached.projection();
            }
            AvailabilityProjection projection = project(now);
            cache.set(new CachedProjection(projection, now.plus(cacheTtl)));
            return projection;
        }
    }

    private AvailabilityProjection project(Instant evaluatedAt) {
        HealthResult ai = safeProbe(aiBaseUrl);
        HealthResult worker = safeProbe(mediaWorkerBaseUrl);

        String infraReason = !ai.up() ? REASON_AI_GATEWAY_DOWN
                : !worker.up() ? REASON_MEDIA_WORKER_DOWN : null;

        boolean fastAvailable = infraReason == null;
        boolean separationEnabled = ai.up() && isSeparationEnabled(ai.body());
        boolean studioAvailable = fastAvailable && separationEnabled;

        Map<String, ModeAvailability> availability = new LinkedHashMap<>();
        availability.put(MODE_FAST, new ModeAvailability(fastAvailable, infraReason));
        availability.put(MODE_STUDIO, new ModeAvailability(
                studioAvailable, studioAvailable ? null
                        : infraReason != null ? infraReason : REASON_SEPARATION_DISABLED));

        String state = ai.up() && worker.up() ? "READY"
                : ai.up() || worker.up() ? "DEGRADED" : "OFFLINE";
        int workerCount = worker.up() ? 1 : 0;
        WorkerCapabilitySummary workerCapability = new WorkerCapabilitySummary(
                state,
                workerCount,
                worker.up() ? 1 : 0,
                worker.up() && separationEnabled ? 1 : 0);

        List<String> readyModes = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        availability.forEach((mode, modeAvailability) -> {
            if (modeAvailability.available()) {
                readyModes.add(mode);
            } else if (modeAvailability.unavailableReason() != null
                    && !reasons.contains(modeAvailability.unavailableReason())) {
                reasons.add(modeAvailability.unavailableReason());
            }
        });
        ReadinessSummary readiness = new ReadinessSummary(
                readyModes.size() == SUPPORTED_MODES.size() ? "READY" : "DRAINING",
                readyModes,
                reasons,
                evaluatedAt.toString());

        return new AvailabilityProjection(
                PROTOCOL_VERSION,
                SUPPORTED_MODES,
                MODE_FAST,
                availability,
                workerCapability,
                readiness);
    }

    private HealthResult safeProbe(String baseUrl) {
        try {
            return healthProbe.probe(baseUrl);
        } catch (Exception ex) {
            return new HealthResult(false, 0, Map.of());
        }
    }

    private boolean isSeparationEnabled(Map<String, Object> aiHealthBody) {
        Object separation = aiHealthBody.get("separation");
        if (!(separation instanceof Map<?, ?> separationMap)) {
            return false;
        }
        Object engine = separationMap.get("engine");
        if (engine == null) {
            return false;
        }
        String engineId = String.valueOf(engine).trim();
        return !engineId.isEmpty()
                && !"none".equalsIgnoreCase(engineId)
                && !"disabled".equalsIgnoreCase(engineId);
    }

    private record CachedProjection(AvailabilityProjection projection, Instant expiresAt) {
    }
}
