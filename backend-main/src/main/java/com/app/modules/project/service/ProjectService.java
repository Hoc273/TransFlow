package com.app.modules.project.service;

import com.app.modules.project.entity.Project;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Project service interface (API_Contract.md §3 & CLAUDE_A.md §4.8).
 */
public interface ProjectService {

    Project createDefaultProject(UUID workspaceId);

    Project resolveOrCreateDefaultProject(UUID workspaceId);

    Optional<Project> findById(UUID projectId);

    List<Project> findByWorkspaceId(UUID workspaceId);

    boolean isMember(UUID projectId, UUID userId);
}
