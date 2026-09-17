package com.app.modules.project.service;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.UserResponse;
import com.app.modules.auth.service.AuthService;
import com.app.modules.project.dto.*;
import com.app.modules.project.entity.Project;
import com.app.modules.project.entity.ProjectMember;
import com.app.modules.project.repository.ProjectMemberRepository;
import com.app.modules.project.repository.ProjectRepository;
import com.app.modules.project.service.impl.ProjectServiceImpl;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ProjectServiceTest {

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private ProjectMemberRepository projectMemberRepository;

    @Mock
    private WorkspaceAccessService workspaceAccessService;

    @Mock
    private AuthService authService;

    private ProjectService projectService;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID leadUserId = UUID.randomUUID();
    private final UUID memberUserId = UUID.randomUUID();
    private final UUID projectId1 = UUID.randomUUID();
    private final UUID projectId2 = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        projectService = new ProjectServiceImpl(
                projectRepository,
                projectMemberRepository,
                workspaceAccessService,
                authService
        );
    }

    @Test
    void listProjects_leadSeesAllProjects() {
        when(workspaceAccessService.getRole(workspaceId, leadUserId)).thenReturn(Role.LEAD);

        Project p1 = new Project();
        p1.setId(projectId1);
        p1.setWorkspaceId(workspaceId);
        p1.setName("Project 1");

        Project p2 = new Project();
        p2.setId(projectId2);
        p2.setWorkspaceId(workspaceId);
        p2.setName("Project 2");

        when(projectRepository.findByWorkspaceId(workspaceId)).thenReturn(List.of(p1, p2));

        List<ProjectResponse> results = projectService.listProjects(workspaceId, leadUserId);
        assertEquals(2, results.size());
    }

    @Test
    void listProjects_memberSeesOnlyAssignedProjects() {
        when(workspaceAccessService.getRole(workspaceId, memberUserId)).thenReturn(Role.MEMBER);

        Project p1 = new Project();
        p1.setId(projectId1);
        p1.setWorkspaceId(workspaceId);
        p1.setName("Project 1");

        Project p2 = new Project();
        p2.setId(projectId2);
        p2.setWorkspaceId(workspaceId);
        p2.setName("Project 2");

        when(projectRepository.findByWorkspaceId(workspaceId)).thenReturn(List.of(p1, p2));

        ProjectMember assignment = new ProjectMember();
        assignment.setProjectId(projectId1);
        assignment.setUserId(memberUserId);

        when(projectMemberRepository.findByUserIdAndProjectIdIn(eq(memberUserId), anySet()))
                .thenReturn(List.of(assignment));

        List<ProjectResponse> results = projectService.listProjects(workspaceId, memberUserId);
        assertEquals(1, results.size());
        assertEquals("Project 1", results.getFirst().name());
    }

    @Test
    void createProject_leadSuccess() {
        doNothing().when(workspaceAccessService).requireWorkspaceLead(workspaceId, leadUserId);

        CreateProjectRequest req = new CreateProjectRequest("Localization Campaign", "vi");
        when(projectRepository.save(any(Project.class))).thenAnswer(inv -> {
            Project p = inv.getArgument(0);
            p.setId(projectId1);
            return p;
        });

        ProjectResponse resp = projectService.createProject(workspaceId, leadUserId, req);
        assertNotNull(resp);
        assertEquals("Localization Campaign", resp.name());
        assertEquals("vi", resp.sourceLang());
    }

    @Test
    void assignMember_leadAssignsMember_success() {
        doNothing().when(workspaceAccessService).requireWorkspaceLead(workspaceId, leadUserId);

        Project p = new Project();
        p.setId(projectId1);
        p.setWorkspaceId(workspaceId);
        when(projectRepository.findById(projectId1)).thenReturn(Optional.of(p));

        when(workspaceAccessService.getRole(workspaceId, memberUserId)).thenReturn(Role.MEMBER);
        when(projectMemberRepository.existsByProjectIdAndUserId(projectId1, memberUserId)).thenReturn(false);

        when(projectMemberRepository.save(any(ProjectMember.class))).thenAnswer(inv -> {
            ProjectMember pm = inv.getArgument(0);
            pm.setId(UUID.randomUUID());
            return pm;
        });

        UserResponse u = new UserResponse(memberUserId, "member@app.com", "Member Name", false);
        when(authService.findUserById(memberUserId)).thenReturn(Optional.of(u));

        AssignProjectMemberRequest req = new AssignProjectMemberRequest(memberUserId);
        ProjectMemberResponse resp = projectService.assignMember(workspaceId, projectId1, leadUserId, req);

        assertNotNull(resp);
        assertEquals(memberUserId, resp.userId());
        assertEquals(Role.MEMBER, resp.role());
        verify(projectMemberRepository).save(any(ProjectMember.class));
    }

    @Test
    void assignMember_cannotAssignLead() {
        doNothing().when(workspaceAccessService).requireWorkspaceLead(workspaceId, leadUserId);

        Project p = new Project();
        p.setId(projectId1);
        p.setWorkspaceId(workspaceId);
        when(projectRepository.findById(projectId1)).thenReturn(Optional.of(p));

        UUID anotherLeadId = UUID.randomUUID();
        when(workspaceAccessService.getRole(workspaceId, anotherLeadId)).thenReturn(Role.LEAD);

        AssignProjectMemberRequest req = new AssignProjectMemberRequest(anotherLeadId);
        AppException ex = assertThrows(AppException.class, () ->
                projectService.assignMember(workspaceId, projectId1, leadUserId, req));
        assertEquals(ErrorCode.LEAD_ALREADY_HAS_FULL_PROJECT_ACCESS, ex.getErrorCode());
    }

    @Test
    void assignMember_userNotInWorkspace_throwsException() {
        doNothing().when(workspaceAccessService).requireWorkspaceLead(workspaceId, leadUserId);

        Project p = new Project();
        p.setId(projectId1);
        p.setWorkspaceId(workspaceId);
        when(projectRepository.findById(projectId1)).thenReturn(Optional.of(p));

        UUID outsiderId = UUID.randomUUID();
        when(workspaceAccessService.getRole(workspaceId, outsiderId))
                .thenThrow(new AppException(ErrorCode.UNAUTHORIZED));

        AssignProjectMemberRequest req = new AssignProjectMemberRequest(outsiderId);
        AppException ex = assertThrows(AppException.class, () ->
                projectService.assignMember(workspaceId, projectId1, leadUserId, req));
        assertEquals(ErrorCode.USER_NOT_WORKSPACE_MEMBER, ex.getErrorCode());
    }

    @Test
    void assignMember_alreadyAssigned_throwsConflict() {
        doNothing().when(workspaceAccessService).requireWorkspaceLead(workspaceId, leadUserId);

        Project p = new Project();
        p.setId(projectId1);
        p.setWorkspaceId(workspaceId);
        when(projectRepository.findById(projectId1)).thenReturn(Optional.of(p));

        when(workspaceAccessService.getRole(workspaceId, memberUserId)).thenReturn(Role.MEMBER);
        when(projectMemberRepository.existsByProjectIdAndUserId(projectId1, memberUserId)).thenReturn(true);

        AssignProjectMemberRequest req = new AssignProjectMemberRequest(memberUserId);
        AppException ex = assertThrows(AppException.class, () ->
                projectService.assignMember(workspaceId, projectId1, leadUserId, req));
        assertEquals(ErrorCode.PROJECT_MEMBER_ALREADY_EXISTS, ex.getErrorCode());
    }

    @Test
    void removeMember_success() {
        doNothing().when(workspaceAccessService).requireWorkspaceLead(workspaceId, leadUserId);

        Project p = new Project();
        p.setId(projectId1);
        p.setWorkspaceId(workspaceId);
        when(projectRepository.findById(projectId1)).thenReturn(Optional.of(p));

        ProjectMember pm = new ProjectMember();
        pm.setProjectId(projectId1);
        pm.setUserId(memberUserId);
        when(projectMemberRepository.findByProjectIdAndUserId(projectId1, memberUserId)).thenReturn(Optional.of(pm));

        projectService.removeMember(workspaceId, projectId1, leadUserId, memberUserId);
        verify(projectMemberRepository).delete(pm);
    }

    @Test
    void removeMemberFromAllProjectsInWorkspace_success() {
        Project p1 = new Project();
        p1.setId(projectId1);
        p1.setWorkspaceId(workspaceId);

        Project p2 = new Project();
        p2.setId(projectId2);
        p2.setWorkspaceId(workspaceId);

        when(projectRepository.findByWorkspaceId(workspaceId)).thenReturn(List.of(p1, p2));

        projectService.removeMemberFromAllProjectsInWorkspace(workspaceId, memberUserId);
        verify(projectMemberRepository).deleteByProjectIdInAndUserId(anySet(), eq(memberUserId));
    }
}
