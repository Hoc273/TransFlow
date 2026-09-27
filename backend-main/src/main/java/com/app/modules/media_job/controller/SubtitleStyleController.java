package com.app.modules.media_job.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.media_job.dto.style.AssignSubtitleStyleRequest;
import com.app.modules.media_job.dto.style.SubtitleStyleDetail;
import com.app.modules.media_job.dto.style.SubtitleStyleListItem;
import com.app.modules.media_job.dto.style.SubtitleStyleSnapshot;
import com.app.modules.media_job.service.SubtitleStyleService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Subtitle styles (API_Contract.md §5). Deliberately NOT under {@code /workspaces/{workspaceId}}: the catalog is
 * workspace-agnostic and job access is derived from the job's own workspace (the frontend is built on these routes).
 */
@RestController
@RequestMapping("/api/media")
public class SubtitleStyleController {

    private final SubtitleStyleService service;

    public SubtitleStyleController(SubtitleStyleService service) {
        this.service = service;
    }

    @GetMapping("/subtitle-styles")
    public ApiResponse<List<SubtitleStyleListItem>> list() {
        return ApiResponse.<List<SubtitleStyleListItem>>builder()
                .data(service.listPresets().stream().map(SubtitleStyleListItem::from).toList()).build();
    }

    @GetMapping("/subtitle-styles/{key}")
    public ApiResponse<SubtitleStyleDetail> get(@PathVariable String key) {
        return ApiResponse.<SubtitleStyleDetail>builder().data(SubtitleStyleDetail.from(service.getPreset(key))).build();
    }

    @GetMapping("/jobs/{jobId}/subtitle-style")
    public ApiResponse<SubtitleStyleSnapshot> current(@AuthenticationPrincipal AuthenticatedUser user,
                                                       @PathVariable UUID jobId) {
        return ApiResponse.<SubtitleStyleSnapshot>builder().data(service.currentStyle(user.id(), jobId)).build();
    }

    @PostMapping("/jobs/{jobId}/subtitle-style")
    public ApiResponse<SubtitleStyleSnapshot> assign(@AuthenticationPrincipal AuthenticatedUser user,
                                                      @PathVariable UUID jobId,
                                                      @RequestBody AssignSubtitleStyleRequest request) {
        return ApiResponse.<SubtitleStyleSnapshot>builder().data(service.assignStyle(user.id(), jobId, request.key())).build();
    }
}
