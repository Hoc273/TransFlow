package com.app.modules.workspace.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.project.entity.Project;
import com.app.modules.project.service.ProjectService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.WorkspaceMember;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Implementation of WorkspaceAccessService (RBAC 3 roles & project assignment).
 * Enforces permissions per CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §4.
 */
@Service
public class WorkspaceAccessServiceImpl implements WorkspaceAccessService {

    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final ProjectService projectService;

    public WorkspaceAccessServiceImpl(WorkspaceMemberRepository workspaceMemberRepository,
                                      ProjectService projectService) {
        this.workspaceMemberRepository = workspaceMemberRepository;
        this.projectService = projectService;
    }

    @Override
    @Transactional(readOnly = true)
    public void requireProjectAccess(UUID workspaceId, UUID userId, UUID projectId) {
        Role role = getRole(workspaceId, userId);
        if (role == Role.LEAD) {
            return; // Lead always has access
        }

        // Member or Client requires explicit project assignment
        if (!projectService.isMember(projectId, userId)) {
            throw new AppException(ErrorCode.UNAUTHORIZED);
        }
    }

    @Override
    @Transactional(readOnly = true)
    public void requireProjectAccess(UUID projectId, UUID userId) {
        Project project = projectService.findById(projectId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        requireProjectAccess(project.getWorkspaceId(), userId, projectId);
    }

    @Override
    @Transactional(readOnly = true)
    public void requireProjectWriteAccess(UUID workspaceId, UUID userId, UUID projectId) {
        Role role = getRole(workspaceId, userId);
        if (role == Role.LEAD) {
            return; // Lead always has write access
        }

        if (role == Role.CLIENT) {
            // Clients are read-only; never permitted write/mutation actions
            throw new AppException(ErrorCode.UNAUTHORIZED);
        }

        if (role == Role.MEMBER) {
            if (!projectService.isMember(projectId, userId)) {
                throw new AppException(ErrorCode.UNAUTHORIZED);
            }
        }
    }

    @Override
    @Transactional(readOnly = true)
    public void requireProjectWriteAccess(UUID projectId, UUID userId) {
        Project project = projectService.findById(projectId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        requireProjectWriteAccess(project.getWorkspaceId(), userId, projectId);
    }

    @Override
    @Transactional(readOnly = true)
    public Role getRole(UUID workspaceId, UUID userId) {
        return workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId)
                .map(WorkspaceMember::getRole)
                .orElseThrow(() -> new AppException(ErrorCode.UNAUTHORIZED));
    }

    @Override
    @Transactional(readOnly = true)
    public void requireRole(UUID workspaceId, UUID userId, Role... allowedRoles) {
        Role actualRole = getRole(workspaceId, userId);
        if (allowedRoles == null || allowedRoles.length == 0) {
            return;
        }
        for (Role allowed : allowedRoles) {
            if (actualRole == allowed) {
                return;
            }
        }
        throw new AppException(ErrorCode.UNAUTHORIZED);
    }

    @Override
    @Transactional(readOnly = true)
    public void requireWorkspaceLead(UUID workspaceId, UUID userId) {
        requireRole(workspaceId, userId, Role.LEAD);
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.Optional<UUID> findLeadUserId(UUID workspaceId) {
        return workspaceMemberRepository.findByWorkspaceIdAndRole(workspaceId, Role.LEAD)
                .map(WorkspaceMember::getUserId);
    }
}
