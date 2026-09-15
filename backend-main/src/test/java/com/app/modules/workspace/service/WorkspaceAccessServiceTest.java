package com.app.modules.workspace.service;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.project.service.ProjectService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.WorkspaceMember;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.service.impl.WorkspaceAccessServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class WorkspaceAccessServiceTest {

    @Mock
    private WorkspaceMemberRepository workspaceMemberRepository;

    @Mock
    private ProjectService projectService;

    private WorkspaceAccessService workspaceAccessService;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        workspaceAccessService = new WorkspaceAccessServiceImpl(workspaceMemberRepository, projectService);
    }

    @Test
    void leadRole_hasProjectAccessAndWriteAccess() {
        WorkspaceMember lead = new WorkspaceMember();
        lead.setRole(Role.LEAD);
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId))
                .thenReturn(Optional.of(lead));

        assertDoesNotThrow(() -> workspaceAccessService.requireProjectAccess(workspaceId, userId, projectId));
        assertDoesNotThrow(() -> workspaceAccessService.requireProjectWriteAccess(workspaceId, userId, projectId));
        assertEquals(Role.LEAD, workspaceAccessService.getRole(workspaceId, userId));
    }

    @Test
    void memberRole_withProjectAssignment_hasReadAndWriteAccess() {
        WorkspaceMember member = new WorkspaceMember();
        member.setRole(Role.MEMBER);
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId))
                .thenReturn(Optional.of(member));
        when(projectService.isMember(projectId, userId)).thenReturn(true);

        assertDoesNotThrow(() -> workspaceAccessService.requireProjectAccess(workspaceId, userId, projectId));
        assertDoesNotThrow(() -> workspaceAccessService.requireProjectWriteAccess(workspaceId, userId, projectId));
    }

    @Test
    void memberRole_withoutProjectAssignment_isDenied() {
        WorkspaceMember member = new WorkspaceMember();
        member.setRole(Role.MEMBER);
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId))
                .thenReturn(Optional.of(member));
        when(projectService.isMember(projectId, userId)).thenReturn(false);

        AppException ex1 = assertThrows(AppException.class, () ->
                workspaceAccessService.requireProjectAccess(workspaceId, userId, projectId));
        assertEquals(ErrorCode.UNAUTHORIZED, ex1.getErrorCode());

        AppException ex2 = assertThrows(AppException.class, () ->
                workspaceAccessService.requireProjectWriteAccess(workspaceId, userId, projectId));
        assertEquals(ErrorCode.UNAUTHORIZED, ex2.getErrorCode());
    }

    @Test
    void clientRole_withProjectAssignment_hasReadAccessButWriteAccessDenied() {
        WorkspaceMember client = new WorkspaceMember();
        client.setRole(Role.CLIENT);
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId))
                .thenReturn(Optional.of(client));
        when(projectService.isMember(projectId, userId)).thenReturn(true);

        // Read access passes
        assertDoesNotThrow(() -> workspaceAccessService.requireProjectAccess(workspaceId, userId, projectId));

        // Write access is denied for Client
        AppException ex = assertThrows(AppException.class, () ->
                workspaceAccessService.requireProjectWriteAccess(workspaceId, userId, projectId));
        assertEquals(ErrorCode.UNAUTHORIZED, ex.getErrorCode());
    }

    @Test
    void nonWorkspaceMember_isDenied() {
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId))
                .thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class, () ->
                workspaceAccessService.getRole(workspaceId, userId));
        assertEquals(ErrorCode.UNAUTHORIZED, ex.getErrorCode());
    }
}
