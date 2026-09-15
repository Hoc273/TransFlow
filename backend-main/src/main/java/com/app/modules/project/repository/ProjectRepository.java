package com.app.modules.project.repository;

import com.app.modules.project.entity.Project;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ProjectRepository extends JpaRepository<Project, UUID> {

    List<Project> findByWorkspaceId(UUID workspaceId);

    Optional<Project> findFirstByWorkspaceIdOrderByCreatedAtAsc(UUID workspaceId);
}
