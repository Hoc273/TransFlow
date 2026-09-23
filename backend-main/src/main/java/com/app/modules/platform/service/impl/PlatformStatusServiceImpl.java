package com.app.modules.platform.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.health.HealthResult;
import com.app.common.health.ServiceHealthProbe;
import com.app.modules.platform.dto.PlatformStatusResponse;
import com.app.modules.platform.dto.PlatformStatusResponse.ServiceStatus;
import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.PlatformStatusService;
import io.minio.BucketExistsArgs;
import io.minio.MinioClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.connection.Connection;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Probes the 6 core services for Super Admin status (API_Contract.md §13.1).
 * Fail-open per service; safe messages only (no secrets/connection strings).
 * backend-ai and media-worker reuse {@link ServiceHealthProbe} (GET /health).
 */
@Service
public class PlatformStatusServiceImpl implements PlatformStatusService {

    private static final Logger log = LoggerFactory.getLogger(PlatformStatusServiceImpl.class);
    private static final String UP = "UP";
    private static final String DOWN = "DOWN";
    private static final String DEGRADED = "DEGRADED";

    private final PlatformAdminAccessService accessService;
    private final JdbcTemplate jdbcTemplate;
    private final RedisConnectionFactory redisConnectionFactory;
    private final ConnectionFactory rabbitConnectionFactory;
    private final MinioClient minioClient;
    private final ServiceHealthProbe healthProbe;
    private final String aiBaseUrl;
    private final String mediaWorkerBaseUrl;
    private final String mediaBucket;

    public PlatformStatusServiceImpl(PlatformAdminAccessService accessService,
                                     JdbcTemplate jdbcTemplate,
                                     RedisConnectionFactory redisConnectionFactory,
                                     ConnectionFactory rabbitConnectionFactory,
                                     MinioClient minioClient,
                                     ServiceHealthProbe healthProbe,
                                     AppProperties props,
                                     @Value("${app.media-worker.base-url:http://localhost:8001}") String mediaWorkerBaseUrl) {
        this.accessService = accessService;
        this.jdbcTemplate = jdbcTemplate;
        this.redisConnectionFactory = redisConnectionFactory;
        this.rabbitConnectionFactory = rabbitConnectionFactory;
        this.minioClient = minioClient;
        this.healthProbe = healthProbe;
        this.aiBaseUrl = props.ai().baseUrl();
        this.mediaWorkerBaseUrl = mediaWorkerBaseUrl;
        this.mediaBucket = props.storage().mediaBucket();
    }

    private static final long PROBE_WAIT_SECONDS = 8;

    /**
     * Probe bound to its service identity — keeps {@code id}/{@code name}
     * available for the timeout fallback instead of losing it to a generic
     * "unknown" row.
     */
    private record ProbeTask(String id, String name,
                             CompletableFuture<ServiceStatus> future) {}

    @Override
    public PlatformStatusResponse status(UUID callerId) {
        accessService.requirePlatformAdmin(callerId);

        Instant checkedAt = Instant.now();
        ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();
        try {
            List<ProbeTask> tasks = List.of(
                    task(pool, "postgresql", "PostgreSQL", this::probePostgresql),
                    task(pool, "redis", "Redis", this::probeRedis),
                    task(pool, "rabbitmq", "RabbitMQ", this::probeRabbitMq),
                    task(pool, "minio", "MinIO", this::probeMinio),
                    task(pool, "ai_gateway", "AI Gateway (FastAPI)", this::probeAiGateway),
                    task(pool, "worker", "Media Worker", this::probeMediaWorker)
            );
            try {
                CompletableFuture.allOf(tasks.stream()
                                .map(ProbeTask::future)
                                .toArray(CompletableFuture[]::new))
                        .get(PROBE_WAIT_SECONDS, TimeUnit.SECONDS);
            } catch (Exception ex) {
                log.debug("platform_status_probe_wait: {}", ex.toString());
                tasks.forEach(t -> t.future().cancel(true));
            }

            List<ServiceStatus> services = new ArrayList<>(6);
            for (ProbeTask t : tasks) {
                if (t.future().isDone() && !t.future().isCompletedExceptionally()) {
                    services.add(t.future().join());
                } else {
                    services.add(new ServiceStatus(t.id(), t.name(), DOWN, null,
                            "probe timed out"));
                }
            }

            String overall = services.stream().allMatch(s -> UP.equals(s.status())) ? UP : DEGRADED;
            return new PlatformStatusResponse(checkedAt, overall, services);
        } finally {
            // shutdown() WITHOUT awaitTermination: try-with-resources/close()
            // would block until every probe returns, silently defeating the
            // PROBE_WAIT_SECONDS timeout when a socket-level hang ignores the
            // interrupt. Stragglers finish on their own client timeouts; the
            // executor is garbage once they do.
            pool.shutdown();
        }
    }

    private static ProbeTask task(ExecutorService pool, String id, String name,
                                  java.util.function.Supplier<ServiceStatus> probe) {
        return new ProbeTask(id, name, CompletableFuture.supplyAsync(probe, pool));
    }

    private ServiceStatus probePostgresql() {
        long start = System.nanoTime();
        try {
            Integer one = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            if (one != null && one == 1) {
                return new ServiceStatus("postgresql", "PostgreSQL", UP, latencyMs(start), null);
            }
            return new ServiceStatus("postgresql", "PostgreSQL", DOWN, latencyMs(start),
                    "unexpected query result");
        } catch (Exception ex) {
            return new ServiceStatus("postgresql", "PostgreSQL", DOWN, latencyMs(start),
                    safeMessage(ex));
        }
    }

    private ServiceStatus probeRedis() {
        long start = System.nanoTime();
        try (var connection = redisConnectionFactory.getConnection()) {
            String pong = connection.ping();
            if (pong != null) {
                return new ServiceStatus("redis", "Redis", UP, latencyMs(start), null);
            }
            return new ServiceStatus("redis", "Redis", DOWN, latencyMs(start), "empty PING");
        } catch (Exception ex) {
            return new ServiceStatus("redis", "Redis", DOWN, latencyMs(start), safeMessage(ex));
        }
    }

    private ServiceStatus probeRabbitMq() {
        long start = System.nanoTime();
        try (Connection connection = rabbitConnectionFactory.createConnection()) {
            if (connection != null && connection.isOpen()) {
                return new ServiceStatus("rabbitmq", "RabbitMQ", UP, latencyMs(start), null);
            }
            return new ServiceStatus("rabbitmq", "RabbitMQ", DOWN, latencyMs(start),
                    "connection not open");
        } catch (Exception ex) {
            return new ServiceStatus("rabbitmq", "RabbitMQ", DOWN, latencyMs(start),
                    safeMessage(ex));
        }
    }

    private ServiceStatus probeMinio() {
        long start = System.nanoTime();
        try {
            minioClient.bucketExists(BucketExistsArgs.builder().bucket(mediaBucket).build());
            return new ServiceStatus("minio", "MinIO", UP, latencyMs(start), null);
        } catch (Exception ex) {
            return new ServiceStatus("minio", "MinIO", DOWN, latencyMs(start), safeMessage(ex));
        }
    }

    private ServiceStatus probeAiGateway() {
        HealthResult result = healthProbe.probe(aiBaseUrl);
        return new ServiceStatus("ai_gateway", "AI Gateway (FastAPI)",
                result.up() ? UP : DOWN, result.latencyMs(),
                result.up() ? null : "GET /health failed");
    }

    private ServiceStatus probeMediaWorker() {
        HealthResult result = healthProbe.probe(mediaWorkerBaseUrl);
        return new ServiceStatus("worker", "Media Worker",
                result.up() ? UP : DOWN, result.latencyMs(),
                result.up() ? null : "GET /health failed");
    }

    private static long latencyMs(long startNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
    }

    /** Strip host/credential-looking detail from probe errors. */
    static String safeMessage(Throwable ex) {
        String msg = ex.getMessage();
        if (msg == null || msg.isBlank()) {
            return ex.getClass().getSimpleName();
        }
        String lower = msg.toLowerCase();
        if (lower.contains("password") || lower.contains("://") || lower.contains("secret")) {
            return "connection failed";
        }
        return msg.length() > 120 ? msg.substring(0, 120) : msg;
    }
}
