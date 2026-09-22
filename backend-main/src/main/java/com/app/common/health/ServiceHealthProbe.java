package com.app.common.health;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.ClientHttpRequestFactories;
import org.springframework.boot.web.client.ClientHttpRequestFactorySettings;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.Map;

/**
 * Shared {@code GET /health} probe for internal services (backend-ai, media-worker, ...).
 * Never throws: network errors, timeouts and non-2xx/{"status":"ok"} responses all yield
 * {@code up=false}. Used by {@code /api/transformation/capabilities} now and intended for
 * reuse by {@code /api/platform/status}.
 */
@Component
public class ServiceHealthProbe {

    private static final Logger log = LoggerFactory.getLogger(ServiceHealthProbe.class);

    private final RestClient restClient;

    @org.springframework.beans.factory.annotation.Autowired
    public ServiceHealthProbe(@Value("${app.health-probe.timeout-ms:2000}") long timeoutMs) {
        var settings = ClientHttpRequestFactorySettings.DEFAULTS
                .withConnectTimeout(Duration.ofMillis(timeoutMs))
                .withReadTimeout(Duration.ofMillis(timeoutMs));
        this.restClient = RestClient.builder()
                .requestFactory(ClientHttpRequestFactories.get(settings))
                .build();
    }

    public ServiceHealthProbe(RestClient restClient) {
        this.restClient = restClient;
    }

    @SuppressWarnings("unchecked")
    public HealthResult probe(String baseUrl) {
        long start = System.nanoTime();
        try {
            Map<String, Object> body = restClient.get()
                    .uri(baseUrl + "/health")
                    .retrieve()
                    .body(Map.class);
            long latencyMs = (System.nanoTime() - start) / 1_000_000;
            Object status = body != null ? body.get("status") : null;
            // A 2xx body that reports a non-ok status still counts as down.
            boolean up = status == null || "ok".equalsIgnoreCase(String.valueOf(status));
            return new HealthResult(up, latencyMs, body != null ? body : Map.of());
        } catch (Exception ex) {
            long latencyMs = (System.nanoTime() - start) / 1_000_000;
            log.debug("Health probe failed for {}: {}", baseUrl, ex.toString());
            return new HealthResult(false, latencyMs, Map.of());
        }
    }
}
