package com.app.modules.workspace.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.workspace.dto.*;
import com.app.modules.workspace.service.WorkspaceService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces")
public class WorkspaceController {

    private final WorkspaceService workspaceService;

    public WorkspaceController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<WorkspaceResponse> create(@AuthenticationPrincipal AuthenticatedUser user,
                                                @Valid @RequestBody CreateWorkspaceRequest req) {
        return ApiResponse.<WorkspaceResponse>builder()
                .data(workspaceService.create(user.id(), req))
                .build();
    }

    @GetMapping
    public ApiResponse<List<WorkspaceResponse>> listMine(@AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<List<WorkspaceResponse>>builder()
                .data(workspaceService.listForUser(user.id()))
                .build();
    }

    @GetMapping("/{workspaceId}")
    public ApiResponse<WorkspaceResponse> get(@AuthenticationPrincipal AuthenticatedUser user,
                                             @PathVariable UUID workspaceId) {
        return ApiResponse.<WorkspaceResponse>builder()
                .data(workspaceService.get(workspaceId, user.id()))
                .build();
    }

    @GetMapping("/{workspaceId}/members")
    public ApiResponse<List<WorkspaceMemberResponse>> members(@AuthenticationPrincipal AuthenticatedUser user,
                                                              @PathVariable UUID workspaceId) {
        return ApiResponse.<List<WorkspaceMemberResponse>>builder()
                .data(workspaceService.listMembers(workspaceId, user.id()))
                .build();
    }

    @PostMapping("/{workspaceId}/members")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<WorkspaceMemberResponse> addMember(@AuthenticationPrincipal AuthenticatedUser user,
                                                          @PathVariable UUID workspaceId,
                                                          @Valid @RequestBody AddWorkspaceMemberRequest req) {
        return ApiResponse.<WorkspaceMemberResponse>builder()
                .data(workspaceService.addMember(workspaceId, user.id(), req))
                .build();
    }

    @PutMapping("/{workspaceId}/members/{memberId}")
    public ApiResponse<WorkspaceMemberResponse> updateRole(@AuthenticationPrincipal AuthenticatedUser user,
                                                           @PathVariable UUID workspaceId,
                                                           @PathVariable UUID memberId,
                                                           @Valid @RequestBody UpdateMemberRoleRequest req) {
        return ApiResponse.<WorkspaceMemberResponse>builder()
                .data(workspaceService.updateMemberRole(workspaceId, user.id(), memberId, req))
                .build();
    }

    @DeleteMapping("/{workspaceId}/members/{memberId}")
    public ApiResponse<Void> removeMember(@AuthenticationPrincipal AuthenticatedUser user,
                                          @PathVariable UUID workspaceId,
                                          @PathVariable UUID memberId) {
        workspaceService.removeMember(workspaceId, user.id(), memberId);
        return ApiResponse.<Void>builder().build();
    }

    @GetMapping("/{workspaceId}/billing-config")
    public ApiResponse<WorkspaceBillingConfigResponse> getBillingConfig(@AuthenticationPrincipal AuthenticatedUser user,
                                                                        @PathVariable UUID workspaceId) {
        return ApiResponse.<WorkspaceBillingConfigResponse>builder()
                .data(workspaceService.getBillingConfig(workspaceId, user.id()))
                .build();
    }

    @PutMapping("/{workspaceId}/billing-config")
    public ApiResponse<WorkspaceBillingConfigResponse> updateBillingConfig(@AuthenticationPrincipal AuthenticatedUser user,
                                                                           @PathVariable UUID workspaceId,
                                                                           @Valid @RequestBody UpdateBillingConfigRequest req) {
        return ApiResponse.<WorkspaceBillingConfigResponse>builder()
                .data(workspaceService.updateBillingConfig(workspaceId, user.id(), req))
                .build();
    }
}
