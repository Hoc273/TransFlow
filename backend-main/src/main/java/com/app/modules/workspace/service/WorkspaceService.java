package com.app.modules.workspace.service;

import com.app.modules.workspace.dto.*;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.Workspace;

import java.util.List;
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

    WorkspaceResponse create(UUID userId, CreateWorkspaceRequest req);

    List<WorkspaceResponse> listForUser(UUID userId);

    WorkspaceResponse get(UUID workspaceId, UUID userId);

    List<WorkspaceMemberResponse> listMembers(UUID workspaceId, UUID userId);

    WorkspaceMemberResponse addMember(UUID workspaceId, UUID actingUserId, AddWorkspaceMemberRequest req);

    WorkspaceMemberResponse updateMemberRole(UUID workspaceId, UUID actingUserId, UUID memberId, UpdateMemberRoleRequest req);

    void removeMember(UUID workspaceId, UUID actingUserId, UUID memberId);

    WorkspaceBillingConfigResponse getBillingConfig(UUID workspaceId, UUID userId);

    WorkspaceBillingConfigResponse updateBillingConfig(UUID workspaceId, UUID actingUserId, UpdateBillingConfigRequest req);
}
