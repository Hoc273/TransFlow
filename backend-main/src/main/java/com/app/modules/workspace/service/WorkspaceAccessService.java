package com.app.modules.workspace.service;

import com.app.modules.workspace.entity.Role;

import java.util.UUID;

/**
 * Interface provided by Member A for Member B to enforce RBAC
 * on Media Asset, Media Job, Batch, Glossary, and QA endpoints.
 * See CLAUDE_A.md §7.4 and Backend_Java_TaskSplit_MemberA.md §4.
 */
public interface WorkspaceAccessService {

    void requireProjectAccess(UUID projectId, UUID userId);

    void requireProjectWriteAccess(UUID projectId, UUID userId);

    Role getRole(UUID workspaceId, UUID userId);
}
