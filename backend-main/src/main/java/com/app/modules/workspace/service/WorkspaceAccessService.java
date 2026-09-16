package com.app.modules.workspace.service;

import com.app.modules.workspace.entity.Role;

import java.util.UUID;

/**
 * Interface provided by Member A for Member B to enforce RBAC
 * on Media Asset, Media Job, Batch, Glossary, and QA endpoints.
 * See CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §4.
 */
public interface WorkspaceAccessService {

    /**
     * Enforces that the user has read/access permissions on the project.
     * LEAD always passes; MEMBER and CLIENT must be explicitly assigned in project_members.
     * Throws AppException(ErrorCode.UNAUTHORIZED) if access is denied.
     */
    void requireProjectAccess(UUID workspaceId, UUID userId, UUID projectId);

    void requireProjectAccess(UUID projectId, UUID userId);

    /**
     * Enforces that the user has write/mutation permissions on the project.
     * LEAD always passes; MEMBER must be assigned in project_members; CLIENT is always denied.
     * Throws AppException(ErrorCode.UNAUTHORIZED) if access is denied.
     */
    void requireProjectWriteAccess(UUID workspaceId, UUID userId, UUID projectId);

    void requireProjectWriteAccess(UUID projectId, UUID userId);

    /**
     * Resolves the user's role in the specified workspace.
     * Throws AppException(ErrorCode.UNAUTHORIZED) if user is not a member of the workspace.
     */
    Role getRole(UUID workspaceId, UUID userId);

    /**
     * Requires the user to have one of the specified roles in the workspace.
     */
    void requireRole(UUID workspaceId, UUID userId, Role... allowedRoles);

    /**
     * Requires the user to be the LEAD in the specified workspace.
     */
    void requireWorkspaceLead(UUID workspaceId, UUID userId);
}
