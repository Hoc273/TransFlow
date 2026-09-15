package com.app.modules.workspace.service;

import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.Workspace;

import java.util.Optional;
import java.util.UUID;

/**
 * Workspace management service interface (API_Contract.md §2 & CLAUDE_A.md §4.8).
 */
public interface WorkspaceService {

    Workspace createDefaultWorkspace(UUID userId, String fullName);

    Optional<UUID> findDefaultWorkspaceIdForUser(UUID userId);

    Optional<Workspace> findById(UUID workspaceId);

    Optional<Role> getRole(UUID workspaceId, UUID userId);

    boolean isMember(UUID workspaceId, UUID userId);
}
