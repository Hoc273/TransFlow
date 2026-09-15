package com.app.modules.project.service.impl;

import com.app.modules.project.entity.Project;
import com.app.modules.project.repository.ProjectMemberRepository;
import com.app.modules.project.repository.ProjectRepository;
import com.app.modules.project.service.ProjectService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class ProjectServiceImpl implements ProjectService {

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;

    public ProjectServiceImpl(ProjectRepository projectRepository,
                              ProjectMemberRepository projectMemberRepository) {
        this.projectRepository = projectRepository;
        this.projectMemberRepository = projectMemberRepository;
    }

    @Override
    @Transactional
    public Project createDefaultProject(UUID workspaceId) {
        Project project = new Project();
        project.setWorkspaceId(workspaceId);
        project.setName("Default Project");
        project.setSourceLang("en");
        return projectRepository.save(project);
    }

    @Override
    @Transactional
    public Project resolveOrCreateDefaultProject(UUID workspaceId) {
        return projectRepository.findFirstByWorkspaceIdOrderByCreatedAtAsc(workspaceId)
                .orElseGet(() -> createDefaultProject(workspaceId));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Project> findById(UUID projectId) {
        return projectRepository.findById(projectId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Project> findByWorkspaceId(UUID workspaceId) {
        return projectRepository.findByWorkspaceId(workspaceId);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean isMember(UUID projectId, UUID userId) {
        return projectMemberRepository.existsByProjectIdAndUserId(projectId, userId);
    }
}
