package com.app.modules.project.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.project.dto.*;
import com.app.modules.project.service.ProjectService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/projects")
public class ProjectController {

    private final ProjectService projectService;

    public ProjectController(ProjectService projectService) {
        this.projectService = projectService;
    }

    @GetMapping
    public ApiResponse<List<ProjectResponse>> list(@AuthenticationPrincipal AuthenticatedUser user,
                                                  @PathVariable UUID workspaceId) {
        return ApiResponse.<List<ProjectResponse>>builder()
                .data(projectService.listProjects(workspaceId, user.id()))
                .build();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<ProjectResponse> create(@AuthenticationPrincipal AuthenticatedUser user,
                                              @PathVariable UUID workspaceId,
                                              @Valid @RequestBody CreateProjectRequest req) {
        return ApiResponse.<ProjectResponse>builder()
                .data(projectService.createProject(workspaceId, user.id(), req))
                .build();
    }

    @GetMapping("/{projectId}/members")
    public ApiResponse<List<ProjectMemberResponse>> listMembers(@AuthenticationPrincipal AuthenticatedUser user,
                                                               @PathVariable UUID workspaceId,
                                                               @PathVariable UUID projectId) {
        return ApiResponse.<List<ProjectMemberResponse>>builder()
                .data(projectService.listProjectMembers(workspaceId, projectId, user.id()))
                .build();
    }

    @PostMapping("/{projectId}/members")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<ProjectMemberResponse> assignMember(@AuthenticationPrincipal AuthenticatedUser user,
                                                          @PathVariable UUID workspaceId,
                                                          @PathVariable UUID projectId,
                                                          @Valid @RequestBody AssignProjectMemberRequest req) {
        return ApiResponse.<ProjectMemberResponse>builder()
                .data(projectService.assignMember(workspaceId, projectId, user.id(), req))
                .build();
    }

    @DeleteMapping("/{projectId}/members/{userId}")
    public ApiResponse<Void> removeMember(@AuthenticationPrincipal AuthenticatedUser user,
                                         @PathVariable UUID workspaceId,
                                         @PathVariable UUID projectId,
                                         @PathVariable UUID userId) {
        projectService.removeMember(workspaceId, projectId, user.id(), userId);
        return ApiResponse.<Void>builder().build();
    }
}
