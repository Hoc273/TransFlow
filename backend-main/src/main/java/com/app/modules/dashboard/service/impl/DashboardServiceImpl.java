package com.app.modules.dashboard.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.UserResponse;
import com.app.modules.auth.service.AuthService;
import com.app.modules.batch.entity.LocalizationBatch;
import com.app.modules.batch.service.BatchService;
import com.app.modules.credit.entity.CostMode;
import com.app.modules.credit.entity.WorkspaceBillingConfig;
import com.app.modules.credit.service.CreditService;
import com.app.modules.dashboard.dto.UsageSummaryResponse;
import com.app.modules.dashboard.dto.WorkspaceDashboardResponse;
import com.app.modules.dashboard.repository.AiUsageLogReadOnlyRepository;
import com.app.modules.dashboard.service.DashboardService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.project.dto.ProjectResponse;
import com.app.modules.project.entity.Project;
import com.app.modules.project.service.ProjectService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class DashboardServiceImpl implements DashboardService {

    private final AiUsageLogReadOnlyRepository aiUsageLogRepository;
    private final WorkspaceAccessService workspaceAccessService;
    private final ProjectService projectService;
    private final MediaJobService mediaJobService;
    private final BatchService batchService;
    private final CreditService creditService;
    private final AuthService authService;

    public DashboardServiceImpl(AiUsageLogReadOnlyRepository aiUsageLogRepository,
                                WorkspaceAccessService workspaceAccessService,
                                ProjectService projectService,
                                MediaJobService mediaJobService,
                                BatchService batchService,
                                CreditService creditService,
                                AuthService authService) {
        this.aiUsageLogRepository = aiUsageLogRepository;
        this.workspaceAccessService = workspaceAccessService;
        this.projectService = projectService;
        this.mediaJobService = mediaJobService;
        this.batchService = batchService;
        this.creditService = creditService;
        this.authService = authService;
    }

    @Override
    @Transactional(readOnly = true)
    public WorkspaceDashboardResponse getDashboard(UUID workspaceId, UUID userId) {
        Role role = workspaceAccessService.getRole(workspaceId, userId);

        // 1. Resolve projects visible to this user
        List<ProjectResponse> visibleProjects = projectService.listProjects(workspaceId, userId);

        // 2. Aggregate job counts
        long totalJobs = 0;
        long pendingJobs = 0;
        long processingJobs = 0;
        long completedJobs = 0;
        long failedJobs = 0;
        long cancelledJobs = 0;

        for (ProjectResponse project : visibleProjects) {
            List<MediaJob> jobs = mediaJobService.listJobs(workspaceId, userId, project.id(), null, null);
            for (MediaJob job : jobs) {
                totalJobs++;
                if (job.getStatus() == MediaJob.JobStatus.PENDING) pendingJobs++;
                else if (job.getStatus() == MediaJob.JobStatus.PROCESSING) processingJobs++;
                else if (job.getStatus() == MediaJob.JobStatus.COMPLETED) completedJobs++;
                else if (job.getStatus() == MediaJob.JobStatus.FAILED) failedJobs++;
                else if (job.getStatus() == MediaJob.JobStatus.CANCELLED) cancelledJobs++;
            }
        }

        WorkspaceDashboardResponse.JobStatusSummary jobSummary = new WorkspaceDashboardResponse.JobStatusSummary(
                totalJobs, pendingJobs, processingJobs, completedJobs, failedJobs, cancelledJobs);

        // 3. Aggregate batch counts
        long totalBatches = 0;
        long runningBatches = 0;
        long completedBatches = 0;
        long failedBatches = 0;
        long partiallyFailedBatches = 0;
        long cancelledBatches = 0;

        for (ProjectResponse project : visibleProjects) {
            List<LocalizationBatch> batches = batchService.listBatches(workspaceId, userId, project.id());
            for (LocalizationBatch batch : batches) {
                totalBatches++;
                if (batch.getStatus() == LocalizationBatch.BatchStatus.PENDING
                        || batch.getStatus() == LocalizationBatch.BatchStatus.PROCESSING) {
                    runningBatches++;
                } else if (batch.getStatus() == LocalizationBatch.BatchStatus.COMPLETED) {
                    completedBatches++;
                } else if (batch.getStatus() == LocalizationBatch.BatchStatus.FAILED) {
                    failedBatches++;
                } else if (batch.getStatus() == LocalizationBatch.BatchStatus.PARTIALLY_FAILED) {
                    partiallyFailedBatches++;
                } else if (batch.getStatus() == LocalizationBatch.BatchStatus.CANCELLED) {
                    cancelledBatches++;
                }
            }
        }

        WorkspaceDashboardResponse.BatchStatusSummary batchSummary = new WorkspaceDashboardResponse.BatchStatusSummary(
                totalBatches, runningBatches, completedBatches, failedBatches, partiallyFailedBatches, cancelledBatches);

        // 4. Resolve Credit remaining by role & cost_mode (SRS §2.4, §5.6 & API Contract §13)
        WorkspaceBillingConfig billingConfig = creditService.getWorkspaceBillingConfig(workspaceId);
        CostMode costMode = (billingConfig != null && billingConfig.getCostMode() != null)
                ? billingConfig.getCostMode()
                : CostMode.PAY_PER_USER;

        BigDecimal creditBalance;
        UUID chargedUserId;

        if (role == Role.LEAD) {
            chargedUserId = userId;
            creditBalance = creditService.getBalance(userId);
        } else {
            // MEMBER or CLIENT
            if (costMode == CostMode.LEAD_PAYS_ALL) {
                UUID leadId = workspaceAccessService.findLeadUserId(workspaceId).orElse(null);
                chargedUserId = leadId;
                creditBalance = (leadId != null) ? creditService.getBalance(leadId) : BigDecimal.ZERO;
            } else {
                chargedUserId = userId;
                creditBalance = creditService.getBalance(userId);
            }
        }

        WorkspaceDashboardResponse.CreditSummary creditSummary = new WorkspaceDashboardResponse.CreditSummary(
                creditBalance, costMode.name(), chargedUserId);

        return new WorkspaceDashboardResponse(jobSummary, batchSummary, creditSummary);
    }

    @Override
    @Transactional(readOnly = true)
    public UsageSummaryResponse getUsage(UUID workspaceId, UUID userId, String groupBy, Instant from, Instant to) {
        Role role = workspaceAccessService.getRole(workspaceId, userId);

        // Clients have no access to usage analytics (API_Contract.md §10)
        if (role == Role.CLIENT) {
            throw new AppException(ErrorCode.UNAUTHORIZED);
        }

        // Validate date range
        if (from != null && to != null && from.isAfter(to)) {
            throw new AppException(ErrorCode.DASHBOARD_DATE_RANGE_INVALID);
        }

        // Normalize and validate groupBy
        String normalizedGroupBy = null;
        if (groupBy != null && !groupBy.isBlank()) {
            normalizedGroupBy = groupBy.trim().toLowerCase();
            if (!normalizedGroupBy.equals("project")
                    && !normalizedGroupBy.equals("user")
                    && !normalizedGroupBy.equals("operation")) {
                throw new AppException(ErrorCode.DASHBOARD_GROUP_BY_INVALID);
            }
        }

        if (from == null) from = Instant.EPOCH;
        if (to == null) to = Instant.parse("9999-12-31T00:00:00Z");

        if (role == Role.LEAD) {
            return aggregateForLead(workspaceId, normalizedGroupBy, from, to);
        } else {
            return aggregateForMember(workspaceId, userId, normalizedGroupBy, from, to);
        }
    }

    private UsageSummaryResponse aggregateForLead(UUID workspaceId, String groupBy, Instant from, Instant to) {
        AiUsageLogReadOnlyRepository.UsageTotals totals =
                aiUsageLogRepository.aggregateWorkspaceTotals(workspaceId, from, to);

        long inputTokens = totals != null && totals.getInputTokens() != null ? totals.getInputTokens() : 0L;
        long outputTokens = totals != null && totals.getOutputTokens() != null ? totals.getOutputTokens() : 0L;
        BigDecimal creditUsed = totals != null && totals.getCreditUsed() != null ? totals.getCreditUsed() : BigDecimal.ZERO;
        long operations = totals != null && totals.getOperations() != null ? totals.getOperations() : 0L;

        List<UsageSummaryResponse.UsageGroupItemResponse> items = new ArrayList<>();

        if ("project".equals(groupBy)) {
            List<AiUsageLogReadOnlyRepository.UsageByProject> list =
                    aiUsageLogRepository.aggregateWorkspaceByProject(workspaceId, from, to);

            Map<UUID, String> projectNameMap = projectService.findByWorkspaceId(workspaceId).stream()
                    .collect(Collectors.toMap(Project::getId, Project::getName, (a, b) -> a));

            for (AiUsageLogReadOnlyRepository.UsageByProject row : list) {
                String label = projectNameMap.getOrDefault(row.getProjectId(), "Project " + row.getProjectId());
                long in = row.getInputTokens() != null ? row.getInputTokens() : 0L;
                long out = row.getOutputTokens() != null ? row.getOutputTokens() : 0L;
                BigDecimal cost = row.getCreditUsed() != null ? row.getCreditUsed() : BigDecimal.ZERO;
                long ops = row.getOperations() != null ? row.getOperations() : 0L;
                items.add(new UsageSummaryResponse.UsageGroupItemResponse(
                        row.getProjectId().toString(), label, in, out, in + out, ops, cost));
            }
        } else if ("user".equals(groupBy)) {
            List<AiUsageLogReadOnlyRepository.UsageByUser> list =
                    aiUsageLogRepository.aggregateWorkspaceByUser(workspaceId, from, to);

            Set<UUID> userIds = list.stream().map(AiUsageLogReadOnlyRepository.UsageByUser::getPerformedByUserId).collect(Collectors.toSet());
            Map<UUID, UserResponse> userMap = authService.findUsersByIds(userIds);

            for (AiUsageLogReadOnlyRepository.UsageByUser row : list) {
                UserResponse u = userMap.get(row.getPerformedByUserId());
                String label = u != null ? (u.fullName() != null ? u.fullName() : u.email()) : "User " + row.getPerformedByUserId();
                long in = row.getInputTokens() != null ? row.getInputTokens() : 0L;
                long out = row.getOutputTokens() != null ? row.getOutputTokens() : 0L;
                BigDecimal cost = row.getCreditUsed() != null ? row.getCreditUsed() : BigDecimal.ZERO;
                long ops = row.getOperations() != null ? row.getOperations() : 0L;
                items.add(new UsageSummaryResponse.UsageGroupItemResponse(
                        row.getPerformedByUserId().toString(), label, in, out, in + out, ops, cost));
            }
        } else if ("operation".equals(groupBy)) {
            List<AiUsageLogReadOnlyRepository.UsageByOperation> list =
                    aiUsageLogRepository.aggregateWorkspaceByOperation(workspaceId, from, to);

            for (AiUsageLogReadOnlyRepository.UsageByOperation row : list) {
                long in = row.getInputTokens() != null ? row.getInputTokens() : 0L;
                long out = row.getOutputTokens() != null ? row.getOutputTokens() : 0L;
                BigDecimal cost = row.getCreditUsed() != null ? row.getCreditUsed() : BigDecimal.ZERO;
                long ops = row.getOperations() != null ? row.getOperations() : 0L;
                items.add(new UsageSummaryResponse.UsageGroupItemResponse(
                        row.getOperation(), row.getOperation(), in, out, in + out, ops, cost));
            }
        }

        return new UsageSummaryResponse(
                inputTokens, outputTokens, inputTokens + outputTokens, operations, creditUsed, groupBy, items);
    }

    private UsageSummaryResponse aggregateForMember(UUID workspaceId, UUID userId, String groupBy, Instant from, Instant to) {
        List<ProjectResponse> assigned = projectService.listProjects(workspaceId, userId);
        if (assigned.isEmpty()) {
            return new UsageSummaryResponse(0L, 0L, 0L, 0L, BigDecimal.ZERO, groupBy, Collections.emptyList());
        }

        List<UUID> projectIds = assigned.stream().map(ProjectResponse::id).toList();

        AiUsageLogReadOnlyRepository.UsageTotals totals =
                aiUsageLogRepository.aggregateProjectsTotals(workspaceId, projectIds, from, to);

        long inputTokens = totals != null && totals.getInputTokens() != null ? totals.getInputTokens() : 0L;
        long outputTokens = totals != null && totals.getOutputTokens() != null ? totals.getOutputTokens() : 0L;
        BigDecimal creditUsed = totals != null && totals.getCreditUsed() != null ? totals.getCreditUsed() : BigDecimal.ZERO;
        long operations = totals != null && totals.getOperations() != null ? totals.getOperations() : 0L;

        List<UsageSummaryResponse.UsageGroupItemResponse> items = new ArrayList<>();

        if ("project".equals(groupBy)) {
            List<AiUsageLogReadOnlyRepository.UsageByProject> list =
                    aiUsageLogRepository.aggregateProjectsByProject(workspaceId, projectIds, from, to);

            Map<UUID, String> projectNameMap = assigned.stream()
                    .collect(Collectors.toMap(ProjectResponse::id, ProjectResponse::name, (a, b) -> a));

            for (AiUsageLogReadOnlyRepository.UsageByProject row : list) {
                String label = projectNameMap.getOrDefault(row.getProjectId(), "Project " + row.getProjectId());
                long in = row.getInputTokens() != null ? row.getInputTokens() : 0L;
                long out = row.getOutputTokens() != null ? row.getOutputTokens() : 0L;
                BigDecimal cost = row.getCreditUsed() != null ? row.getCreditUsed() : BigDecimal.ZERO;
                long ops = row.getOperations() != null ? row.getOperations() : 0L;
                items.add(new UsageSummaryResponse.UsageGroupItemResponse(
                        row.getProjectId().toString(), label, in, out, in + out, ops, cost));
            }
        } else if ("user".equals(groupBy)) {
            List<AiUsageLogReadOnlyRepository.UsageByUser> list =
                    aiUsageLogRepository.aggregateProjectsByUser(workspaceId, projectIds, from, to);

            Set<UUID> userIds = list.stream().map(AiUsageLogReadOnlyRepository.UsageByUser::getPerformedByUserId).collect(Collectors.toSet());
            Map<UUID, UserResponse> userMap = authService.findUsersByIds(userIds);

            for (AiUsageLogReadOnlyRepository.UsageByUser row : list) {
                UserResponse u = userMap.get(row.getPerformedByUserId());
                String label = u != null ? (u.fullName() != null ? u.fullName() : u.email()) : "User " + row.getPerformedByUserId();
                long in = row.getInputTokens() != null ? row.getInputTokens() : 0L;
                long out = row.getOutputTokens() != null ? row.getOutputTokens() : 0L;
                BigDecimal cost = row.getCreditUsed() != null ? row.getCreditUsed() : BigDecimal.ZERO;
                long ops = row.getOperations() != null ? row.getOperations() : 0L;
                items.add(new UsageSummaryResponse.UsageGroupItemResponse(
                        row.getPerformedByUserId().toString(), label, in, out, in + out, ops, cost));
            }
        } else if ("operation".equals(groupBy)) {
            List<AiUsageLogReadOnlyRepository.UsageByOperation> list =
                    aiUsageLogRepository.aggregateProjectsByOperation(workspaceId, projectIds, from, to);

            for (AiUsageLogReadOnlyRepository.UsageByOperation row : list) {
                long in = row.getInputTokens() != null ? row.getInputTokens() : 0L;
                long out = row.getOutputTokens() != null ? row.getOutputTokens() : 0L;
                BigDecimal cost = row.getCreditUsed() != null ? row.getCreditUsed() : BigDecimal.ZERO;
                long ops = row.getOperations() != null ? row.getOperations() : 0L;
                items.add(new UsageSummaryResponse.UsageGroupItemResponse(
                        row.getOperation(), row.getOperation(), in, out, in + out, ops, cost));
            }
        }

        return new UsageSummaryResponse(
                inputTokens, outputTokens, inputTokens + outputTokens, operations, creditUsed, groupBy, items);
    }
}
