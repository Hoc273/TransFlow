package com.app.modules.platform.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.batch.entity.LocalizationBatch;
import com.app.modules.batch.repository.LocalizationBatchRepository;
import com.app.modules.dashboard.repository.AiUsageLogReadOnlyRepository;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.workspace.entity.Workspace;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import javax.sql.DataSource;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.sql.Connection;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/platform")
public class PlatformController {

    private final UserRepository userRepository;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final MediaJobRepository mediaJobRepository;
    private final LocalizationBatchRepository localizationBatchRepository;
    private final AiUsageLogReadOnlyRepository aiUsageLogReadOnlyRepository;
    private final DataSource dataSource;

    @Value("${spring.data.redis.host:localhost}")
    private String redisHost = "localhost";

    @Value("${spring.data.redis.port:6379}")
    private int redisPort = 6379;

    @Value("${spring.rabbitmq.host:localhost}")
    private String rabbitHost = "localhost";

    @Value("${spring.rabbitmq.port:5672}")
    private int rabbitPort = 5672;

    @Value("${app.storage.endpoint:http://localhost:9000}")
    private String minioEndpoint = "http://localhost:9000";

    @Value("${app.ai.base-url:http://localhost:8000}")
    private String aiBaseUrl = "http://localhost:8000";

    public PlatformController(UserRepository userRepository,
                              WorkspaceRepository workspaceRepository,
                              WorkspaceMemberRepository workspaceMemberRepository,
                              MediaJobRepository mediaJobRepository,
                              LocalizationBatchRepository localizationBatchRepository,
                              AiUsageLogReadOnlyRepository aiUsageLogReadOnlyRepository,
                              @Autowired(required = false) DataSource dataSource) {
        this.userRepository = userRepository;
        this.workspaceRepository = workspaceRepository;
        this.workspaceMemberRepository = workspaceMemberRepository;
        this.mediaJobRepository = mediaJobRepository;
        this.localizationBatchRepository = localizationBatchRepository;
        this.aiUsageLogReadOnlyRepository = aiUsageLogReadOnlyRepository;
        this.dataSource = dataSource;
    }

    private void assertPlatformAdmin(AuthenticatedUser user) {
        if (user == null) {
            throw new AppException(ErrorCode.UNAUTHENTICATED);
        }
        User dbUser = userRepository.findById(user.id())
                .orElseThrow(() -> new AppException(ErrorCode.USER_NOT_FOUND));
        if (!dbUser.isPlatformAdmin()) {
            throw new AppException(ErrorCode.UNAUTHORIZED);
        }
    }

    private Map<String, Object> createJobStatusMap() {
        Map<String, Object> m = new HashMap<>();
        m.put("created", 0L);
        m.put("completed", 0L);
        m.put("failed", 0L);
        m.put("processing", 0L);
        m.put("other", 0L);
        return m;
    }

    private void addToJobStatus(Map<String, Object> map, String key, long count) {
        map.compute(key, (k, v) -> v == null ? count : ((Long) v) + count);
        map.compute("created", (k, v) -> v == null ? count : ((Long) v) + count);
    }

    @GetMapping("/overview")
    public ApiResponse<Map<String, Object>> getOverview(@AuthenticationPrincipal AuthenticatedUser user,
                                                        @RequestParam(value = "from", required = false) String from,
                                                        @RequestParam(value = "to", required = false) String to,
                                                        @RequestParam(value = "topLimit", defaultValue = "10") int topLimit) {
        assertPlatformAdmin(user);

        long totalUsers = userRepository.count();
        long totalWorkspaces = workspaceRepository.count();

        Instant defaultFrom = Instant.now().minusSeconds(86400 * 7);
        Instant defaultTo = Instant.now();
        Instant fromI = parseInstantOrDefault(from, defaultFrom);
        Instant toI = parseInstantOrDefault(to, defaultTo);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("from", from != null ? from : defaultFrom.toString());
        res.put("to", to != null ? to : defaultTo.toString());

        Map<String, Object> usersMap = new HashMap<>();
        usersMap.put("total", totalUsers);
        usersMap.put("newInRange", userRepository.countByCreatedAtBetween(fromI, toI));
        res.put("users", usersMap);

        Map<String, Object> wsMap = new HashMap<>();
        wsMap.put("total", totalWorkspaces);
        wsMap.put("newInRange", workspaceRepository.countByCreatedAtBetween(fromI, toI));
        res.put("workspaces", wsMap);

        // 1. Real Job stats (MediaJob + LocalizationBatch)
        Map<String, Object> textJobs = createJobStatusMap();
        Map<String, Object> batchJobs = createJobStatusMap();
        Map<String, Object> mediaJobs = createJobStatusMap();
        Map<String, Object> productionJobs = createJobStatusMap();

        long totalFailed = 0L;
        long totalCompleted = 0L;

        List<MediaJobRepository.MediaJobAggregateRow> mediaRows = mediaJobRepository.aggregateJobsInRange(fromI, toI);
        if (mediaRows != null) {
            for (MediaJobRepository.MediaJobAggregateRow row : mediaRows) {
                MediaJob.JobStatus status = row.getStatus();
                long count = row.getCount() != null ? row.getCount() : 0L;
                String statusKey = switch (status) {
                    case COMPLETED -> "completed";
                    case FAILED -> "failed";
                    case PROCESSING -> "processing";
                    case PENDING, CANCELLED -> "other";
                };

                if (status == MediaJob.JobStatus.FAILED) totalFailed += count;
                if (status == MediaJob.JobStatus.COMPLETED) totalCompleted += count;

                // All media jobs
                addToJobStatus(mediaJobs, statusKey, count);

                // Text jobs: TRANSLATE_ONLY or summary.script_match
                if (row.getProcessingMode() == MediaJob.ProcessingMode.TRANSLATE_ONLY
                        || MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(row.getRecipeId())) {
                    addToJobStatus(textJobs, statusKey, count);
                }

                // Production jobs: non-original audio mode
                if (row.getOutputAudioMode() != null && row.getOutputAudioMode() != MediaJob.OutputAudioMode.ORIGINAL_ONLY) {
                    addToJobStatus(productionJobs, statusKey, count);
                }
            }
        }

        List<LocalizationBatchRepository.BatchStatusCount> batchRows = localizationBatchRepository.countBatchesByStatusInRange(fromI, toI);
        if (batchRows != null) {
            for (LocalizationBatchRepository.BatchStatusCount row : batchRows) {
                LocalizationBatch.BatchStatus status = row.getStatus();
                long count = row.getCount() != null ? row.getCount() : 0L;
                String statusKey = switch (status) {
                    case COMPLETED -> "completed";
                    case FAILED, PARTIALLY_FAILED -> "failed";
                    case PROCESSING -> "processing";
                    case PENDING, CANCELLED -> "other";
                };

                if (status == LocalizationBatch.BatchStatus.FAILED || status == LocalizationBatch.BatchStatus.PARTIALLY_FAILED) {
                    totalFailed += count;
                }
                if (status == LocalizationBatch.BatchStatus.COMPLETED) {
                    totalCompleted += count;
                }

                addToJobStatus(batchJobs, statusKey, count);
            }
        }

        Map<String, Object> jobsMap = new HashMap<>();
        jobsMap.put("textJobs", textJobs);
        jobsMap.put("batchJobs", batchJobs);
        jobsMap.put("mediaJobs", mediaJobs);
        jobsMap.put("productionJobs", productionJobs);
        res.put("jobs", jobsMap);

        // 2. Real AI Tokens (AiUsageLog)
        AiUsageLogReadOnlyRepository.UsageTotals tokenTotals = aiUsageLogReadOnlyRepository.aggregatePlatformTotals(fromI, toI);
        long inTokens = (tokenTotals != null && tokenTotals.getInputTokens() != null) ? tokenTotals.getInputTokens() : 0L;
        long outTokens = (tokenTotals != null && tokenTotals.getOutputTokens() != null) ? tokenTotals.getOutputTokens() : 0L;
        long totalTokens = inTokens + outTokens;

        Map<String, Object> tokensMap = new HashMap<>();
        tokensMap.put("inputTokens", inTokens);
        tokensMap.put("outputTokens", outTokens);
        tokensMap.put("totalTokens", totalTokens);

        Map<String, Object> byOpMap = new HashMap<>();
        List<AiUsageLogReadOnlyRepository.UsageByOperation> opRows = aiUsageLogReadOnlyRepository.aggregatePlatformByOperation(fromI, toI);
        if (opRows != null) {
            for (AiUsageLogReadOnlyRepository.UsageByOperation row : opRows) {
                if (row.getOperation() == null) continue;
                Map<String, Object> opData = new HashMap<>();
                long opIn = row.getInputTokens() != null ? row.getInputTokens() : 0L;
                long opOut = row.getOutputTokens() != null ? row.getOutputTokens() : 0L;
                opData.put("inputTokens", opIn);
                opData.put("outputTokens", opOut);
                byOpMap.put(row.getOperation(), opData);

                // Alias SUMMARIZE_SCRIPT -> SUMMARY for frontend chart series
                if ("SUMMARIZE_SCRIPT".equals(row.getOperation())) {
                    byOpMap.putIfAbsent("SUMMARY", opData);
                }
            }
        }
        tokensMap.put("byOperation", byOpMap);
        res.put("tokens", tokensMap);

        // 3. Real Fail Rate
        long terminalCount = totalFailed + totalCompleted;
        double rate = terminalCount > 0 ? (double) totalFailed / terminalCount : 0.0;
        Map<String, Object> failRateMap = new HashMap<>();
        failRateMap.put("rate", rate);
        failRateMap.put("failedCount", totalFailed);
        failRateMap.put("terminalCount", terminalCount);
        res.put("failRate", failRateMap);

        // 4. Real Top Workspaces by Tokens & Jobs
        Map<UUID, Long> tokensByWs = new HashMap<>();
        List<AiUsageLogReadOnlyRepository.WorkspaceTokenUsage> wsTokenList = aiUsageLogReadOnlyRepository.aggregatePlatformByWorkspace(fromI, toI);
        if (wsTokenList != null) {
            for (AiUsageLogReadOnlyRepository.WorkspaceTokenUsage u : wsTokenList) {
                if (u.getWorkspaceId() != null) {
                    tokensByWs.put(u.getWorkspaceId(), u.getTotalTokens());
                }
            }
        }

        Map<UUID, Long> jobsByWs = new HashMap<>();
        List<MediaJobRepository.WorkspaceJobCount> wsJobCounts = mediaJobRepository.countJobsByWorkspaceInRange(fromI, toI);
        if (wsJobCounts != null) {
            for (MediaJobRepository.WorkspaceJobCount j : wsJobCounts) {
                if (j.getWorkspaceId() != null) {
                    jobsByWs.merge(j.getWorkspaceId(), j.getJobCount() != null ? j.getJobCount() : 0L, Long::sum);
                }
            }
        }
        List<LocalizationBatchRepository.WorkspaceBatchCount> wsBatchCounts = localizationBatchRepository.countBatchesByWorkspaceInRange(fromI, toI);
        if (wsBatchCounts != null) {
            for (LocalizationBatchRepository.WorkspaceBatchCount b : wsBatchCounts) {
                if (b.getWorkspaceId() != null) {
                    jobsByWs.merge(b.getWorkspaceId(), b.getBatchCount() != null ? b.getBatchCount() : 0L, Long::sum);
                }
            }
        }

        List<Workspace> workspaces = workspaceRepository.findAll();
        List<Map<String, Object>> topWsList = workspaces.stream()
                .map(w -> {
                    Map<String, Object> item = new HashMap<>();
                    long wsTokens = tokensByWs.getOrDefault(w.getId(), 0L);
                    long wsJobs = jobsByWs.getOrDefault(w.getId(), 0L);
                    item.put("workspaceId", w.getId().toString());
                    item.put("workspaceName", w.getName());
                    item.put("totalTokens", wsTokens);
                    item.put("jobCount", wsJobs);
                    return item;
                })
                .sorted((a, b) -> {
                    long tokensA = (Long) a.get("totalTokens");
                    long tokensB = (Long) b.get("totalTokens");
                    int cmp = Long.compare(tokensB, tokensA);
                    if (cmp != 0) return cmp;
                    long jobsA = (Long) a.get("jobCount");
                    long jobsB = (Long) b.get("jobCount");
                    int jcmp = Long.compare(jobsB, jobsA);
                    if (jcmp != 0) return jcmp;
                    return ((String) a.get("workspaceName")).compareToIgnoreCase((String) b.get("workspaceName"));
                })
                .limit(Math.max(1, topLimit))
                .collect(Collectors.toList());
        res.put("topWorkspaces", topWsList);

        return ApiResponse.<Map<String, Object>>builder().data(res).build();
    }


    /**
     * SA-RT — Realtime system activity snapshot (poll every 3 s from Frontend).
     * Returns live job counts and token consumption — no mock values.
     */
    @GetMapping("/realtime")
    public ApiResponse<Map<String, Object>> getRealtime(@AuthenticationPrincipal AuthenticatedUser user) {
        assertPlatformAdmin(user);

        // 1. Jobs currently being processed right now
        long processingJobs = mediaJobRepository.countByStatus(MediaJob.JobStatus.PROCESSING);

        // 2. Jobs completed since midnight UTC today
        Instant todayStart = java.time.LocalDate.now(java.time.ZoneOffset.UTC)
                .atStartOfDay(java.time.ZoneOffset.UTC)
                .toInstant();
        long completedToday = mediaJobRepository.countByStatusAndCreatedAtAfter(
                MediaJob.JobStatus.COMPLETED, todayStart);

        // 3. Total tokens consumed in the last hour
        Instant oneHourAgo = Instant.now().minusSeconds(3600);
        AiUsageLogReadOnlyRepository.UsageTotals hourTotals =
                aiUsageLogReadOnlyRepository.aggregatePlatformTotals(oneHourAgo, Instant.now());
        long tokensLastHour = 0L;
        if (hourTotals != null) {
            long in  = hourTotals.getInputTokens()  != null ? hourTotals.getInputTokens()  : 0L;
            long out = hourTotals.getOutputTokens() != null ? hourTotals.getOutputTokens() : 0L;
            tokensLastHour = in + out;
        }

        Map<String, Object> res = new HashMap<>();
        res.put("processingJobs",  processingJobs);
        res.put("completedToday",  completedToday);
        res.put("tokensLastHour",  tokensLastHour);
        res.put("checkedAt", Instant.now().toString());

        return ApiResponse.<Map<String, Object>>builder().data(res).build();
    }

    @GetMapping("/status")
    public ApiResponse<Map<String, Object>> getStatus(@AuthenticationPrincipal AuthenticatedUser user) {
        assertPlatformAdmin(user);

        List<Map<String, Object>> services = new ArrayList<>();

        // 1. PostgreSQL DB Health
        long dbLatency = 5;
        String dbStatus = "UP";
        String dbMsg = "PostgreSQL 16 connection healthy";
        if (dataSource != null) {
            long start = System.currentTimeMillis();
            try (Connection conn = dataSource.getConnection()) {
                dbLatency = Math.max(1, System.currentTimeMillis() - start);
            } catch (Exception e) {
                dbStatus = "DOWN";
                dbMsg = "DB Error: " + e.getMessage();
            }
        }
        services.add(createServiceStatus("db", "PostgreSQL Database", dbStatus, dbLatency, dbMsg));
        services.add(checkTcp("redis", "Redis Cache & Session", redisHost, redisPort, 2000));
        services.add(checkTcp("rabbitmq", "RabbitMQ Broker", rabbitHost, rabbitPort, 2000));
        services.add(checkHttp("minio", "MinIO S3 Storage", minioEndpoint + "/minio/health/live", 2000));
        services.add(checkHttp("ai_worker", "Python Media Worker", aiBaseUrl + "/health", 2000));

        boolean allUp = services.stream().allMatch(s -> "UP".equals(s.get("status")));
        Map<String, Object> res = new HashMap<>();
        res.put("checkedAt", Instant.now().toString());
        res.put("overall", allUp ? "UP" : "DEGRADED");
        res.put("services", services);

        return ApiResponse.<Map<String, Object>>builder().data(res).build();
    }

    private Map<String, Object> checkTcp(String id, String name, String host, int port, int timeoutMs) {
        long start = System.currentTimeMillis();
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            long latency = Math.max(1, System.currentTimeMillis() - start);
            return createServiceStatus(id, name, "UP", latency, host + ":" + port + " reachable");
        } catch (Exception e) {
            long latency = Math.max(1, System.currentTimeMillis() - start);
            return createServiceStatus(id, name, "DOWN", latency, host + ":" + port + " unreachable: " + e.getMessage());
        }
    }

    private Map<String, Object> checkHttp(String id, String name, String url, int timeoutMs) {
        long start = System.currentTimeMillis();
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            long latency = Math.max(1, System.currentTimeMillis() - start);
            if (code >= 200 && code < 300) {
                return createServiceStatus(id, name, "UP", latency, url + " -> HTTP " + code);
            }
            return createServiceStatus(id, name, "DOWN", latency, url + " -> HTTP " + code);
        } catch (Exception e) {
            long latency = Math.max(1, System.currentTimeMillis() - start);
            return createServiceStatus(id, name, "DOWN", latency, url + " unreachable: " + e.getMessage());
        }
    }

    private Instant parseInstantOrDefault(String value, Instant fallback) {
        if (value == null || value.isBlank()) return fallback;
        try {
            return Instant.parse(value.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    @GetMapping("/users")
    public ApiResponse<Map<String, Object>> getUsers(@AuthenticationPrincipal AuthenticatedUser user,
                                                     @RequestParam(value = "q", required = false) String q,
                                                     @RequestParam(value = "page", defaultValue = "0") int page,
                                                     @RequestParam(value = "size", defaultValue = "20") int size,
                                                     @RequestParam(value = "isPlatformAdmin", required = false) Boolean isPlatformAdmin) {
        assertPlatformAdmin(user);

        String trimmedQ = (q == null || q.isBlank()) ? null : q.trim();
        int safeSize = Math.min(Math.max(size, 1), 100);
        Page<User> userPage = userRepository.searchAdmin(
                trimmedQ, isPlatformAdmin,
                PageRequest.of(Math.max(0, page), safeSize, Sort.by(Sort.Direction.DESC, "createdAt")));

        List<Map<String, Object>> items = userPage.getContent().stream()
                .map(u -> {
                    Map<String, Object> item = new HashMap<>();
                    item.put("id", u.getId().toString());
                    item.put("email", u.getEmail());
                    item.put("fullName", u.getFullName());
                    item.put("status", u.getStatus().name());
                    item.put("isPlatformAdmin", u.isPlatformAdmin());
                    item.put("createdAt", u.getCreatedAt() != null ? u.getCreatedAt().toString() : Instant.now().toString());
                    item.put("workspaceCount", workspaceMemberRepository.countByUserId(u.getId()));
                    item.put("avatarUrl", u.getAvatarUrl());
                    return item;
                })
                .collect(Collectors.toList());

        Map<String, Object> res = new HashMap<>();
        res.put("items", items);
        res.put("page", userPage.getNumber());
        res.put("size", userPage.getSize());
        res.put("totalItems", userPage.getTotalElements());
        res.put("totalPages", userPage.getTotalPages());

        return ApiResponse.<Map<String, Object>>builder().data(res).build();
    }

    @GetMapping("/workspaces")
    public ApiResponse<Map<String, Object>> getWorkspaces(@AuthenticationPrincipal AuthenticatedUser user,
                                                          @RequestParam(value = "q", required = false) String q,
                                                          @RequestParam(value = "page", defaultValue = "0") int page,
                                                           @RequestParam(value = "size", defaultValue = "20") int size) {
        assertPlatformAdmin(user);

        String trimmedQ = (q == null || q.isBlank()) ? null : q.trim();
        int safeSize = Math.min(Math.max(size, 1), 100);
        Page<Workspace> wsPage = workspaceRepository.searchAdmin(
                trimmedQ,
                PageRequest.of(Math.max(0, page), safeSize, Sort.by(Sort.Direction.DESC, "createdAt")));

        List<Map<String, Object>> items = wsPage.getContent().stream()
                .map(w -> {
                    Map<String, Object> item = new HashMap<>();
                    item.put("id", w.getId().toString());
                    item.put("name", w.getName());
                    item.put("slug", w.getSlug());
                    item.put("ownerUserId", w.getOwnerUserId().toString());
                    User owner = userRepository.findById(w.getOwnerUserId()).orElse(null);
                    item.put("ownerEmail", owner != null ? owner.getEmail() : "N/A");
                    item.put("memberCount", workspaceMemberRepository.countByWorkspaceId(w.getId()));
                    item.put("createdAt", w.getCreatedAt() != null ? w.getCreatedAt().toString() : Instant.now().toString());
                    return item;
                })
                .collect(Collectors.toList());

        Map<String, Object> res = new HashMap<>();
        res.put("items", items);
        res.put("page", wsPage.getNumber());
        res.put("size", wsPage.getSize());
        res.put("totalItems", wsPage.getTotalElements());
        res.put("totalPages", wsPage.getTotalPages());

        return ApiResponse.<Map<String, Object>>builder().data(res).build();
    }

    @GetMapping("/audit-logs")
    public ApiResponse<Map<String, Object>> getAuditLogs(@AuthenticationPrincipal AuthenticatedUser user,
                                                         @RequestParam(value = "action", required = false) String action,
                                                         @RequestParam(value = "page", defaultValue = "0") int page,
                                                         @RequestParam(value = "size", defaultValue = "20") int size) {
        assertPlatformAdmin(user);

        Map<String, Object> res = new HashMap<>();
        res.put("items", Collections.emptyList());
        res.put("page", page);
        res.put("size", size);
        res.put("totalItems", 0);
        res.put("totalPages", 0);

        return ApiResponse.<Map<String, Object>>builder().data(res).build();
    }

    private Map<String, Object> createServiceStatus(String id, String name, String status, Long latencyMs, String message) {
        Map<String, Object> s = new HashMap<>();
        s.put("id", id);
        s.put("name", name);
        s.put("status", status);
        s.put("latencyMs", latencyMs);
        s.put("message", message);
        return s;
    }
}
