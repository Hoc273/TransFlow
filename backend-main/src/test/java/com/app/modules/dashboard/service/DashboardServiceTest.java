package com.app.modules.dashboard.service;

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
import com.app.modules.dashboard.service.impl.DashboardServiceImpl;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.project.dto.ProjectResponse;
import com.app.modules.project.service.ProjectService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class DashboardServiceTest {

    @Mock
    private AiUsageLogReadOnlyRepository aiUsageLogRepository;

    @Mock
    private WorkspaceAccessService workspaceAccessService;

    @Mock
    private ProjectService projectService;

    @Mock
    private MediaJobService mediaJobService;

    @Mock
    private BatchService batchService;

    @Mock
    private CreditService creditService;

    @Mock
    private AuthService authService;

    private DashboardService dashboardService;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID leadUserId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        dashboardService = new DashboardServiceImpl(
                aiUsageLogRepository, workspaceAccessService, projectService,
                mediaJobService, batchService, creditService, authService);
    }

    @Test
    @DisplayName("getDashboard: correctly aggregates job statuses, batch statuses and credit for LEAD")
    void getDashboard_lead_success() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.LEAD);

        ProjectResponse project = new ProjectResponse(projectId, workspaceId, "Project 1", "en", Instant.now(), Instant.now());
        when(projectService.listProjects(workspaceId, userId)).thenReturn(List.of(project));

        MediaJob job1 = new MediaJob();
        job1.setStatus(MediaJob.JobStatus.PROCESSING);
        MediaJob job2 = new MediaJob();
        job2.setStatus(MediaJob.JobStatus.COMPLETED);
        when(mediaJobService.listJobs(workspaceId, userId, projectId, null, null))
                .thenReturn(List.of(job1, job2));

        LocalizationBatch batch1 = new LocalizationBatch();
        batch1.setStatus(LocalizationBatch.BatchStatus.PROCESSING);
        when(batchService.listBatches(workspaceId, userId, projectId))
                .thenReturn(List.of(batch1));

        WorkspaceBillingConfig billingConfig = new WorkspaceBillingConfig();
        billingConfig.setCostMode(CostMode.PAY_PER_USER);
        when(creditService.getWorkspaceBillingConfig(workspaceId)).thenReturn(billingConfig);
        when(creditService.getBalance(userId)).thenReturn(new BigDecimal("125.5000"));

        WorkspaceDashboardResponse res = dashboardService.getDashboard(workspaceId, userId);

        assertThat(res.jobs().total()).isEqualTo(2);
        assertThat(res.jobs().processing()).isEqualTo(1);
        assertThat(res.jobs().completed()).isEqualTo(1);

        assertThat(res.batches().total()).isEqualTo(1);
        assertThat(res.batches().running()).isEqualTo(1);

        assertThat(res.credit().costMode()).isEqualTo("PAY_PER_USER");
        assertThat(res.credit().balance()).isEqualTo(new BigDecimal("125.5000"));
        assertThat(res.credit().chargedUserId()).isEqualTo(userId);
    }

    @Test
    @DisplayName("getDashboard: resolves lead balance when MEMBER and costMode is LEAD_PAYS_ALL")
    void getDashboard_member_leadPaysAll() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.MEMBER);
        when(projectService.listProjects(workspaceId, userId)).thenReturn(List.of());

        WorkspaceBillingConfig billingConfig = new WorkspaceBillingConfig();
        billingConfig.setCostMode(CostMode.LEAD_PAYS_ALL);
        when(creditService.getWorkspaceBillingConfig(workspaceId)).thenReturn(billingConfig);
        when(workspaceAccessService.findLeadUserId(workspaceId)).thenReturn(Optional.of(leadUserId));
        when(creditService.getBalance(leadUserId)).thenReturn(new BigDecimal("500.0000"));

        WorkspaceDashboardResponse res = dashboardService.getDashboard(workspaceId, userId);

        assertThat(res.jobs().total()).isZero();
        assertThat(res.batches().total()).isZero();
        assertThat(res.credit().costMode()).isEqualTo("LEAD_PAYS_ALL");
        assertThat(res.credit().balance()).isEqualTo(new BigDecimal("500.0000"));
        assertThat(res.credit().chargedUserId()).isEqualTo(leadUserId);
    }

    @Test
    @DisplayName("getUsage: throws UNAUTHORIZED for CLIENT")
    void getUsage_client_unauthorized() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.CLIENT);

        assertThatThrownBy(() -> dashboardService.getUsage(workspaceId, userId, null, null, null))
                .isInstanceOf(AppException.class)
                .matches(e -> ((AppException) e).getErrorCode() == ErrorCode.UNAUTHORIZED);
    }

    @Test
    @DisplayName("getUsage: throws DASHBOARD_DATE_RANGE_INVALID when from > to")
    void getUsage_invalidDateRange() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.LEAD);

        Instant from = Instant.parse("2026-09-16T12:00:00Z");
        Instant to = Instant.parse("2026-09-15T12:00:00Z");

        assertThatThrownBy(() -> dashboardService.getUsage(workspaceId, userId, null, from, to))
                .isInstanceOf(AppException.class)
                .matches(e -> ((AppException) e).getErrorCode() == ErrorCode.DASHBOARD_DATE_RANGE_INVALID);
    }

    @Test
    @DisplayName("getUsage: throws DASHBOARD_GROUP_BY_INVALID for unsupported groupBy")
    void getUsage_invalidGroupBy() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.LEAD);

        assertThatThrownBy(() -> dashboardService.getUsage(workspaceId, userId, "invalid_group", null, null))
                .isInstanceOf(AppException.class)
                .matches(e -> ((AppException) e).getErrorCode() == ErrorCode.DASHBOARD_GROUP_BY_INVALID);
    }

    @Test
    @DisplayName("getUsage: LEAD groupBy operation aggregates totals and breakdown items")
    void getUsage_lead_groupByOperation() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.LEAD);

        AiUsageLogReadOnlyRepository.UsageTotals totals = mock(AiUsageLogReadOnlyRepository.UsageTotals.class);
        when(totals.getInputTokens()).thenReturn(1000L);
        when(totals.getOutputTokens()).thenReturn(500L);
        when(totals.getCreditUsed()).thenReturn(new BigDecimal("0.1500"));
        when(totals.getOperations()).thenReturn(4L);
        when(aiUsageLogRepository.aggregateWorkspaceTotals(eq(workspaceId), any(), any())).thenReturn(totals);

        AiUsageLogReadOnlyRepository.UsageByOperation op1 = mock(AiUsageLogReadOnlyRepository.UsageByOperation.class);
        when(op1.getOperation()).thenReturn("TRANSLATE");
        when(op1.getInputTokens()).thenReturn(600L);
        when(op1.getOutputTokens()).thenReturn(300L);
        when(op1.getCreditUsed()).thenReturn(new BigDecimal("0.0900"));
        when(op1.getOperations()).thenReturn(2L);

        when(aiUsageLogRepository.aggregateWorkspaceByOperation(eq(workspaceId), any(), any()))
                .thenReturn(List.of(op1));

        UsageSummaryResponse res = dashboardService.getUsage(workspaceId, userId, "operation", null, null);

        assertThat(res.totalInputTokens()).isEqualTo(1000L);
        assertThat(res.totalOutputTokens()).isEqualTo(500L);
        assertThat(res.totalTokens()).isEqualTo(1500L);
        assertThat(res.totalOperations()).isEqualTo(4L);
        assertThat(res.totalCreditUsed()).isEqualTo(new BigDecimal("0.1500"));
        assertThat(res.items()).hasSize(1);
        assertThat(res.items().get(0).groupKey()).isEqualTo("TRANSLATE");
        assertThat(res.items().get(0).operations()).isEqualTo(2L);
    }
}
