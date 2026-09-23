package com.app.modules.platform.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.platform.dto.JobStatusCounts;
import com.app.modules.platform.dto.PlatformOverviewResponse;
import com.app.modules.platform.dto.PlatformOverviewResponse.*;
import com.app.modules.platform.dto.UnavailableJobType;
import com.app.modules.platform.repository.PlatformAiUsageLogViewRepository;
import com.app.modules.platform.repository.PlatformLocalizationBatchViewRepository;
import com.app.modules.platform.repository.PlatformMediaJobViewRepository;
import com.app.modules.platform.repository.PlatformUserViewRepository;
import com.app.modules.platform.repository.PlatformWorkspaceViewRepository;
import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.PlatformAnalyticsService;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class PlatformAnalyticsServiceImpl implements PlatformAnalyticsService {

    private static final int DEFAULT_TOP = 10;
    private static final int MAX_TOP = 50;
    private static final long DEFAULT_RANGE_DAYS = 7;

    private final PlatformAdminAccessService accessService;
    private final PlatformUserViewRepository userViewRepository;
    private final PlatformWorkspaceViewRepository workspaceViewRepository;
    private final PlatformMediaJobViewRepository mediaJobViewRepository;
    private final PlatformLocalizationBatchViewRepository batchViewRepository;
    private final PlatformAiUsageLogViewRepository usageLogViewRepository;

    public PlatformAnalyticsServiceImpl(PlatformAdminAccessService accessService,
                                        PlatformUserViewRepository userViewRepository,
                                        PlatformWorkspaceViewRepository workspaceViewRepository,
                                        PlatformMediaJobViewRepository mediaJobViewRepository,
                                        PlatformLocalizationBatchViewRepository batchViewRepository,
                                        PlatformAiUsageLogViewRepository usageLogViewRepository) {
        this.accessService = accessService;
        this.userViewRepository = userViewRepository;
        this.workspaceViewRepository = workspaceViewRepository;
        this.mediaJobViewRepository = mediaJobViewRepository;
        this.batchViewRepository = batchViewRepository;
        this.usageLogViewRepository = usageLogViewRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformOverviewResponse overview(UUID callerId, Instant from, Instant to, Integer topLimit) {
        accessService.requirePlatformAdmin(callerId);

        Instant effectiveTo = to != null ? to : Instant.now();
        Instant effectiveFrom = from != null ? from : effectiveTo.minus(DEFAULT_RANGE_DAYS, ChronoUnit.DAYS);
        if (!effectiveFrom.isBefore(effectiveTo)) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        int limit = clampTop(topLimit);

        CountInRange users = new CountInRange(
                userViewRepository.count(),
                userViewRepository.countByCreatedAtGreaterThanEqualAndCreatedAtLessThan(effectiveFrom, effectiveTo));
        CountInRange workspaces = new CountInRange(
                workspaceViewRepository.count(),
                workspaceViewRepository.countByCreatedAtGreaterThanEqualAndCreatedAtLessThan(effectiveFrom, effectiveTo));

        JobStatusCounts mediaJobs = mapMediaJobs(
                mediaJobViewRepository.countByStatusInRange(effectiveFrom, effectiveTo));
        JobStatusCounts batchJobs = mapBatchJobs(
                batchViewRepository.countByStatusInRange(effectiveFrom, effectiveTo));
        JobsBlock jobs = new JobsBlock(mediaJobs, batchJobs,
                UnavailableJobType.INSTANCE, UnavailableJobType.INSTANCE);

        var tokenTotals = usageLogViewRepository.aggregatePlatformRange(effectiveFrom, effectiveTo);
        long input = tokenTotals != null && tokenTotals.getInputTokens() != null ? tokenTotals.getInputTokens() : 0;
        long output = tokenTotals != null && tokenTotals.getOutputTokens() != null ? tokenTotals.getOutputTokens() : 0;
        Map<String, OperationTokens> byOp = new LinkedHashMap<>();
        for (var row : usageLogViewRepository.aggregatePlatformByOperation(effectiveFrom, effectiveTo)) {
            byOp.put(row.getOperation() != null ? row.getOperation() : "UNKNOWN",
                    new OperationTokens(
                            row.getInputTokens() != null ? row.getInputTokens() : 0,
                            row.getOutputTokens() != null ? row.getOutputTokens() : 0));
        }
        TokensBlock tokens = new TokensBlock(input, output, input + output, byOp);

        // failRate covers both job types: media_jobs + localization_batches (PARTIALLY_FAILED counts as failed).
        long failedCount = mediaJobs.failed() + batchJobs.failed();
        long terminalCount = mediaJobs.completed() + mediaJobs.failed()
                + batchJobs.completed() + batchJobs.failed();
        Double rate = terminalCount == 0 ? null : (double) failedCount / (double) terminalCount;
        FailRateBlock failRate = new FailRateBlock(rate, failedCount, terminalCount);

        List<TopWorkspaceItem> top = usageLogViewRepository
                .topWorkspacesByTokens(effectiveFrom, effectiveTo, PageRequest.of(0, limit))
                .stream()
                .map(r -> new TopWorkspaceItem(
                        r.getWorkspaceId(),
                        r.getWorkspaceName(),
                        r.getTotalTokens() != null ? r.getTotalTokens() : 0,
                        r.getJobCount() != null ? r.getJobCount() : 0))
                .toList();

        return new PlatformOverviewResponse(
                effectiveFrom, effectiveTo, users, workspaces, jobs, tokens, failRate, top);
    }

    private static int clampTop(Integer topLimit) {
        if (topLimit == null || topLimit <= 0) {
            return DEFAULT_TOP;
        }
        return Math.min(topLimit, MAX_TOP);
    }

    /** media_jobs.status ∈ PENDING|PROCESSING|COMPLETED|FAILED|CANCELLED. */
    private static JobStatusCounts mapMediaJobs(List<PlatformMediaJobViewRepository.StatusCount> rows) {
        long completed = 0, failed = 0, processing = 0, other = 0;
        for (var row : rows) {
            long n = row.getCnt();
            switch (row.getStatus()) {
                case "COMPLETED" -> completed += n;
                case "FAILED" -> failed += n;
                case "PROCESSING" -> processing += n;
                default -> other += n; // PENDING, CANCELLED, future values
            }
        }
        return JobStatusCounts.of(completed, failed, processing, other);
    }

    /** localization_batches.status — PARTIALLY_FAILED counts as failed. */
    private static JobStatusCounts mapBatchJobs(List<PlatformLocalizationBatchViewRepository.StatusCount> rows) {
        long completed = 0, failed = 0, processing = 0, other = 0;
        for (var row : rows) {
            long n = row.getCnt();
            switch (row.getStatus()) {
                case "COMPLETED" -> completed += n;
                case "FAILED", "PARTIALLY_FAILED" -> failed += n;
                case "PROCESSING" -> processing += n;
                default -> other += n; // PENDING, CANCELLED
            }
        }
        return JobStatusCounts.of(completed, failed, processing, other);
    }
}
