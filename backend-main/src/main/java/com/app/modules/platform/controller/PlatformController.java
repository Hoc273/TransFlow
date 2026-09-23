package com.app.modules.platform.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.platform.dto.PlatformAuditLogItem;
import com.app.modules.platform.dto.PlatformOverviewResponse;
import com.app.modules.platform.dto.PlatformPageResponse;
import com.app.modules.platform.dto.PlatformStatusResponse;
import com.app.modules.platform.dto.PlatformUserItem;
import com.app.modules.platform.dto.PlatformWorkspaceItem;
import com.app.modules.platform.service.PlatformAnalyticsService;
import com.app.modules.platform.service.PlatformAuditQueryService;
import com.app.modules.platform.service.PlatformDirectoryService;
import com.app.modules.platform.service.PlatformStatusService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * Platform Super Admin API — read-only (SRS §5.8, API_Contract.md §13.1).
 * Authorization is enforced at the service layer via
 * {@code PlatformAdminAccessService.requirePlatformAdmin} (CLAUDE.md §5 rule 6);
 * request audit is written by {@code PlatformAdminAuditFilter}.
 */
@RestController
@RequestMapping("/api/platform")
public class PlatformController {

    private final PlatformAnalyticsService analyticsService;
    private final PlatformStatusService statusService;
    private final PlatformDirectoryService directoryService;
    private final PlatformAuditQueryService auditQueryService;

    public PlatformController(PlatformAnalyticsService analyticsService,
                              PlatformStatusService statusService,
                              PlatformDirectoryService directoryService,
                              PlatformAuditQueryService auditQueryService) {
        this.analyticsService = analyticsService;
        this.statusService = statusService;
        this.directoryService = directoryService;
        this.auditQueryService = auditQueryService;
    }

    /** 6 KPI analytics snapshot. */
    @GetMapping("/overview")
    public ApiResponse<PlatformOverviewResponse> overview(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) Integer topLimit) {
        return ApiResponse.<PlatformOverviewResponse>builder()
                .data(analyticsService.overview(user.id(), from, to, topLimit))
                .build();
    }

    /** Health of the core services (PostgreSQL, Redis, RabbitMQ, MinIO, backend-ai, media-worker). */
    @GetMapping("/status")
    public ApiResponse<PlatformStatusResponse> status(@AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<PlatformStatusResponse>builder()
                .data(statusService.status(user.id()))
                .build();
    }

    /** User directory (metadata only). */
    @GetMapping("/users")
    public ApiResponse<PlatformPageResponse<PlatformUserItem>> users(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Boolean isPlatformAdmin,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return ApiResponse.<PlatformPageResponse<PlatformUserItem>>builder()
                .data(directoryService.listUsers(user.id(), q, isPlatformAdmin, page, size))
                .build();
    }

    /** Workspace directory (metadata only). */
    @GetMapping("/workspaces")
    public ApiResponse<PlatformPageResponse<PlatformWorkspaceItem>> workspaces(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return ApiResponse.<PlatformPageResponse<PlatformWorkspaceItem>>builder()
                .data(directoryService.listWorkspaces(user.id(), q, page, size))
                .build();
    }

    /** Self-read Super Admin audit logs. */
    @GetMapping("/audit-logs")
    public ApiResponse<PlatformPageResponse<PlatformAuditLogItem>> auditLogs(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return ApiResponse.<PlatformPageResponse<PlatformAuditLogItem>>builder()
                .data(auditQueryService.list(user.id(), action, page, size))
                .build();
    }
}
