package com.app.modules.workspace.repository;

import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.WorkspaceMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember, UUID> {

    List<WorkspaceMember> findByUserId(UUID userId);

    List<WorkspaceMember> findByWorkspaceId(UUID workspaceId);

    Optional<WorkspaceMember> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);

    Optional<WorkspaceMember> findByWorkspaceIdAndRole(UUID workspaceId, Role role);

    boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
}
