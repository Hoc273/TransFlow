package com.app.modules.project.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.UserResponse;
import com.app.modules.auth.service.AuthService;
import com.app.modules.project.dto.*;
import com.app.modules.project.entity.Project;
import com.app.modules.project.entity.ProjectMember;
import com.app.modules.project.repository.ProjectMemberRepository;
import com.app.modules.project.repository.ProjectRepository;
import com.app.modules.project.service.ProjectService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class ProjectServiceImpl implements ProjectService {

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final WorkspaceAccessService workspaceAccessService;
    private final AuthService authService;

    public ProjectServiceImpl(ProjectRepository projectRepository,
                              ProjectMemberRepository projectMemberRepository,
                              @Lazy WorkspaceAccessService workspaceAccessService,
                              @Lazy AuthService authService) {
        this.projectRepository = projectRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.workspaceAccessService = workspaceAccessService;
        this.authService = authService;
    }

    @Override
    @Transactional
    public Project createDefaultProject(UUID workspaceId) {
        Project project = new Project();
        project.setWorkspaceId(workspaceId);
        project.setName("Default Project");
        project.setSourceLang("en");
        project.setTmEnabled(true);
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

    @Override
    @Transactional(readOnly = true)
    public List<ProjectResponse> listProjects(UUID workspaceId, UUID userId) {
        Role role = workspaceAccessService.getRole(workspaceId, userId);

        List<Project> allProjects = projectRepository.findByWorkspaceId(workspaceId);
        if (role == Role.LEAD) {
            return allProjects.stream().map(ProjectResponse::from).toList();
        }

        if (allProjects.isEmpty()) {
            return Collections.emptyList();
        }

        Set<UUID> projectIds = allProjects.stream().map(Project::getId).collect(Collectors.toSet());
        List<ProjectMember> assignments = projectMemberRepository.findByUserIdAndProjectIdIn(userId, projectIds);
        Set<UUID> assignedProjectIds = assignments.stream().map(ProjectMember::getProjectId).collect(Collectors.toSet());

        return allProjects.stream()
                .filter(p -> assignedProjectIds.contains(p.getId()))
                .map(ProjectResponse::from)
                .toList();
    }

    @Override
    @Transactional
    public ProjectResponse createProject(UUID workspaceId, UUID actingUserId, CreateProjectRequest req) {
        workspaceAccessService.requireWorkspaceLead(workspaceId, actingUserId);

        Project project = new Project();
        project.setWorkspaceId(workspaceId);
        project.setName(req.name().trim());
        project.setSourceLang(req.sourceLang() != null && !req.sourceLang().isBlank() ? req.sourceLang().trim() : "en");
        project.setDefaultGlossaryId(req.defaultGlossaryId());
        project.setTmEnabled(req.tmEnabled() != null ? req.tmEnabled() : true);
        project.setDomain(req.domain() != null && !req.domain().isBlank() ? req.domain().trim() : null);
        project.setTone(req.tone() != null && !req.tone().isBlank() ? req.tone().trim() : null);
        return ProjectResponse.from(projectRepository.save(project));
    }

    @Override
    @Transactional(readOnly = true)
    public List<ProjectMemberResponse> listProjectMembers(UUID workspaceId, UUID projectId, UUID actingUserId) {
        workspaceAccessService.requireWorkspaceLead(workspaceId, actingUserId);

        projectRepository.findById(projectId)
                .filter(p -> p.getWorkspaceId().equals(workspaceId))
                .orElseThrow(() -> new AppException(ErrorCode.PROJECT_NOT_FOUND));

        List<ProjectMember> assignments = projectMemberRepository.findByProjectId(projectId);
        if (assignments.isEmpty()) {
            return Collections.emptyList();
        }

        Set<UUID> userIds = assignments.stream().map(ProjectMember::getUserId).collect(Collectors.toSet());
        Map<UUID, UserResponse> userMap = authService.findUsersByIds(userIds);

        return assignments.stream().map(a -> {
            UserResponse u = userMap.get(a.getUserId());
            Role role;
            try {
                role = workspaceAccessService.getRole(workspaceId, a.getUserId());
            } catch (AppException e) {
                role = null;
            }
            return new ProjectMemberResponse(
                    a.getId(),
                    a.getProjectId(),
                    a.getUserId(),
                    u != null ? u.email() : null,
                    u != null ? u.fullName() : null,
                    role,
                    a.getAddedBy(),
                    a.getCreatedAt()
            );
        }).toList();
    }

    @Override
    @Transactional
    public ProjectMemberResponse assignMember(UUID workspaceId, UUID projectId, UUID actingUserId, AssignProjectMemberRequest req) {
        workspaceAccessService.requireWorkspaceLead(workspaceId, actingUserId);

        projectRepository.findById(projectId)
                .filter(p -> p.getWorkspaceId().equals(workspaceId))
                .orElseThrow(() -> new AppException(ErrorCode.PROJECT_NOT_FOUND));

        UUID targetUserId = req.userId();
        Role targetRole;
        try {
            targetRole = workspaceAccessService.getRole(workspaceId, targetUserId);
        } catch (AppException ex) {
            if (ex.getErrorCode() == ErrorCode.UNAUTHORIZED) {
                throw new AppException(ErrorCode.USER_NOT_WORKSPACE_MEMBER);
            }
            throw ex;
        }

        if (targetRole == Role.LEAD) {
            throw new AppException(ErrorCode.LEAD_ALREADY_HAS_FULL_PROJECT_ACCESS);
        }

        if (projectMemberRepository.existsByProjectIdAndUserId(projectId, targetUserId)) {
            throw new AppException(ErrorCode.PROJECT_MEMBER_ALREADY_EXISTS);
        }

        ProjectMember pm = new ProjectMember();
        pm.setProjectId(projectId);
        pm.setUserId(targetUserId);
        pm.setAddedBy(actingUserId);
        ProjectMember saved = projectMemberRepository.save(pm);

        UserResponse u = authService.findUserById(targetUserId).orElse(null);
        return new ProjectMemberResponse(
                saved.getId(),
                projectId,
                targetUserId,
                u != null ? u.email() : null,
                u != null ? u.fullName() : null,
                targetRole,
                actingUserId,
                saved.getCreatedAt()
        );
    }

    @Override
    @Transactional
    public void removeMember(UUID workspaceId, UUID projectId, UUID actingUserId, UUID userId) {
        workspaceAccessService.requireWorkspaceLead(workspaceId, actingUserId);

        projectRepository.findById(projectId)
                .filter(p -> p.getWorkspaceId().equals(workspaceId))
                .orElseThrow(() -> new AppException(ErrorCode.PROJECT_NOT_FOUND));

        ProjectMember pm = projectMemberRepository.findByProjectIdAndUserId(projectId, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROJECT_MEMBER_NOT_FOUND));

        projectMemberRepository.delete(pm);
    }

    @Override
    @Transactional
    public void removeMemberFromAllProjectsInWorkspace(UUID workspaceId, UUID userId) {
        List<Project> projects = projectRepository.findByWorkspaceId(workspaceId);
        if (projects.isEmpty()) {
            return;
        }
        Set<UUID> projectIds = projects.stream().map(Project::getId).collect(Collectors.toSet());
        projectMemberRepository.deleteByProjectIdInAndUserId(projectIds, userId);
    }
}
