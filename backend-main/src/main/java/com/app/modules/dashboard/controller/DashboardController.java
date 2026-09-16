package com.app.modules.dashboard.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.dashboard.dto.UsageSummaryResponse;
import com.app.modules.dashboard.dto.WorkspaceDashboardResponse;
import com.app.modules.dashboard.service.DashboardService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Controller for Workspace Dashboard and Usage Telemetry (API_Contract.md §10 line 239 & §13).
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}")
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    /**
     * GET /api/workspaces/{workspaceId}/dashboard
     * Tổng hợp nhanh: số job theo status, batch đang chạy, Credit còn lại theo role và cost_mode (API_Contract.md §13).
     */
    @GetMapping("/dashboard")
    public ApiResponse<WorkspaceDashboardResponse> getDashboard(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId) {
        WorkspaceDashboardResponse response = dashboardService.getDashboard(workspaceId, user.id());
        return ApiResponse.<WorkspaceDashboardResponse>builder()
                .data(response)
                .build();
    }

    /**
     * GET /api/workspaces/{workspaceId}/usage?groupBy=project|user|operation&from=&to=
     * Alias: GET /api/workspaces/{workspaceId}/dashboard/usage
     * Bảng theo dõi mức sử dụng AI (SRS §5.6, API_Contract.md §10 line 239).
     */
    @GetMapping({"/usage", "/dashboard/usage"})
    public ApiResponse<UsageSummaryResponse> getUsage(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId,
            @RequestParam(required = false) String groupBy,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {
        UsageSummaryResponse response = dashboardService.getUsage(workspaceId, user.id(), groupBy, from, to);
        return ApiResponse.<UsageSummaryResponse>builder()
                .data(response)
                .build();
    }
}
