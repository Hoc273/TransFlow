package com.app.modules.workspace.repository;

import com.app.modules.workspace.entity.Workspace;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface WorkspaceRepository extends JpaRepository<Workspace, UUID> {

    List<Workspace> findByOwnerUserId(UUID ownerUserId);

    boolean existsBySlug(String slug);

    Optional<Workspace> findBySlug(String slug);
}
