package com.app.modules.workspace.service;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.UserResponse;
import com.app.modules.auth.service.AuthService;
import com.app.modules.credit.entity.CostMode;
import com.app.modules.credit.entity.WorkspaceBillingConfig;
import com.app.modules.credit.service.CreditService;
import com.app.modules.project.service.ProjectService;
import com.app.modules.workspace.dto.*;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.Workspace;
import com.app.modules.workspace.entity.WorkspaceMember;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import com.app.modules.workspace.service.impl.WorkspaceServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class WorkspaceServiceTest {

    @Mock
    private WorkspaceRepository workspaceRepository;

    @Mock
    private WorkspaceMemberRepository workspaceMemberRepository;

    @Mock
    private AuthService authService;

    @Mock
    private CreditService creditService;

    @Mock
    private ProjectService projectService;

    private WorkspaceService workspaceService;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID leadUserId = UUID.randomUUID();
    private final UUID memberUserId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        workspaceService = new WorkspaceServiceImpl(
                workspaceRepository,
                workspaceMemberRepository,
                authService,
                creditService,
                projectService
        );
    }

    @Test
    void createWorkspace_success() {
        CreateWorkspaceRequest req = new CreateWorkspaceRequest("My Team", "my-team");
        when(workspaceRepository.existsBySlug("my-team")).thenReturn(false);
        when(workspaceRepository.save(any(Workspace.class))).thenAnswer(inv -> {
            Workspace ws = inv.getArgument(0);
            ws.setId(workspaceId);
            return ws;
        });

        WorkspaceResponse resp = workspaceService.create(leadUserId, req);

        assertNotNull(resp);
        assertEquals("My Team", resp.name());
        assertEquals("my-team", resp.slug());
        assertEquals(leadUserId, resp.ownerUserId());
        assertEquals(Role.LEAD, resp.role());

        verify(creditService).initWorkspaceBillingConfig(eq(workspaceId), eq(leadUserId), eq(CostMode.PAY_PER_USER));
        verify(projectService).createDefaultProject(eq(workspaceId));
    }

    @Test
    void createWorkspace_slugConflict_throwsException() {
        CreateWorkspaceRequest req = new CreateWorkspaceRequest("My Team", "existing-slug");
        when(workspaceRepository.existsBySlug("existing-slug")).thenReturn(true);

        AppException ex = assertThrows(AppException.class, () ->
                workspaceService.create(leadUserId, req));
        assertEquals(ErrorCode.WORKSPACE_SLUG_ALREADY_EXISTS, ex.getErrorCode());
    }

    @Test
    void listForUser_returnsUserWorkspaces() {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(workspaceId);
        m.setUserId(memberUserId);
        m.setRole(Role.MEMBER);

        Workspace ws = new Workspace();
        ws.setId(workspaceId);
        ws.setName("Test WS");
        ws.setSlug("test-ws");
        ws.setOwnerUserId(leadUserId);

        when(workspaceMemberRepository.findByUserId(memberUserId)).thenReturn(List.of(m));
        when(workspaceRepository.findAllById(anySet())).thenReturn(List.of(ws));

        List<WorkspaceResponse> list = workspaceService.listForUser(memberUserId);
        assertEquals(1, list.size());
        assertEquals("Test WS", list.getFirst().name());
        assertEquals(Role.MEMBER, list.getFirst().role());
    }

    @Test
    void get_whenMember_returnsWorkspace() {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(workspaceId);
        m.setUserId(memberUserId);
        m.setRole(Role.MEMBER);

        Workspace ws = new Workspace();
        ws.setId(workspaceId);
        ws.setName("Test WS");
        ws.setSlug("test-ws");
        ws.setOwnerUserId(leadUserId);

        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, memberUserId))
                .thenReturn(Optional.of(m));
        when(workspaceRepository.findById(workspaceId)).thenReturn(Optional.of(ws));

        WorkspaceResponse resp = workspaceService.get(workspaceId, memberUserId);
        assertNotNull(resp);
        assertEquals(Role.MEMBER, resp.role());
    }

    @Test
    void get_whenNotMember_throwsUnauthorized() {
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, memberUserId))
                .thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class, () ->
                workspaceService.get(workspaceId, memberUserId));
        assertEquals(ErrorCode.UNAUTHORIZED, ex.getErrorCode());
    }

    @Test
    void addMember_success() {
        WorkspaceMember lead = new WorkspaceMember();
        lead.setRole(Role.LEAD);
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, leadUserId))
                .thenReturn(Optional.of(lead));

        UserResponse targetUser = new UserResponse(memberUserId, "member@app.com", "Member Name", false);
        when(authService.findUserByEmail("member@app.com")).thenReturn(Optional.of(targetUser));
        when(workspaceMemberRepository.existsByWorkspaceIdAndUserId(workspaceId, memberUserId)).thenReturn(false);

        AddWorkspaceMemberRequest req = new AddWorkspaceMemberRequest("member@app.com", Role.MEMBER);
        WorkspaceMemberResponse resp = workspaceService.addMember(workspaceId, leadUserId, req);

        assertNotNull(resp);
        assertEquals(memberUserId, resp.userId());
        assertEquals(Role.MEMBER, resp.role());
        verify(workspaceMemberRepository).save(any(WorkspaceMember.class));
    }

    @Test
    void addMember_cannotAddLeadRole() {
        WorkspaceMember lead = new WorkspaceMember();
        lead.setRole(Role.LEAD);
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, leadUserId))
                .thenReturn(Optional.of(lead));

        AddWorkspaceMemberRequest req = new AddWorkspaceMemberRequest("lead2@app.com", Role.LEAD);
        AppException ex = assertThrows(AppException.class, () ->
                workspaceService.addMember(workspaceId, leadUserId, req));
        assertEquals(ErrorCode.CANNOT_ASSIGN_LEAD_ROLE, ex.getErrorCode());
    }

    @Test
    void addMember_alreadyMember_throwsConflict() {
        WorkspaceMember lead = new WorkspaceMember();
        lead.setRole(Role.LEAD);
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, leadUserId))
                .thenReturn(Optional.of(lead));

        UserResponse targetUser = new UserResponse(memberUserId, "member@app.com", "Member Name", false);
        when(authService.findUserByEmail("member@app.com")).thenReturn(Optional.of(targetUser));
        when(workspaceMemberRepository.existsByWorkspaceIdAndUserId(workspaceId, memberUserId)).thenReturn(true);

        AddWorkspaceMemberRequest req = new AddWorkspaceMemberRequest("member@app.com", Role.MEMBER);
        AppException ex = assertThrows(AppException.class, () ->
                workspaceService.addMember(workspaceId, leadUserId, req));
        assertEquals(ErrorCode.WORKSPACE_MEMBER_ALREADY_EXISTS, ex.getErrorCode());
    }

    @Test
    void updateMemberRole_cannotChangeLeadRole() {
        WorkspaceMember lead = new WorkspaceMember();
        lead.setRole(Role.LEAD);
        lead.setUserId(leadUserId);
        UUID memberId = UUID.randomUUID();
        lead.setId(memberId);
        lead.setWorkspaceId(workspaceId);

        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, leadUserId))
                .thenReturn(Optional.of(lead));
        when(workspaceMemberRepository.findById(memberId)).thenReturn(Optional.of(lead));

        UpdateMemberRoleRequest req = new UpdateMemberRoleRequest(Role.MEMBER);
        AppException ex = assertThrows(AppException.class, () ->
                workspaceService.updateMemberRole(workspaceId, leadUserId, memberId, req));
        assertEquals(ErrorCode.LEAD_CANNOT_BE_REMOVED, ex.getErrorCode());
    }

    @Test
    void removeMember_success_cascadesToProjectMembers() {
        WorkspaceMember lead = new WorkspaceMember();
        lead.setRole(Role.LEAD);
        lead.setUserId(leadUserId);
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, leadUserId))
                .thenReturn(Optional.of(lead));

        UUID memberRecordId = UUID.randomUUID();
        WorkspaceMember targetMember = new WorkspaceMember();
        targetMember.setId(memberRecordId);
        targetMember.setWorkspaceId(workspaceId);
        targetMember.setUserId(memberUserId);
        targetMember.setRole(Role.MEMBER);

        Workspace ws = new Workspace();
        ws.setId(workspaceId);
        ws.setOwnerUserId(leadUserId);

        when(workspaceMemberRepository.findById(memberRecordId)).thenReturn(Optional.of(targetMember));
        when(workspaceRepository.findById(workspaceId)).thenReturn(Optional.of(ws));

        workspaceService.removeMember(workspaceId, leadUserId, memberRecordId);

        verify(projectService).removeMemberFromAllProjectsInWorkspace(workspaceId, memberUserId);
        verify(workspaceMemberRepository).delete(targetMember);
    }

    @Test
    void billingConfig_getAndUpdate() {
        WorkspaceMember lead = new WorkspaceMember();
        lead.setRole(Role.LEAD);
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, leadUserId))
                .thenReturn(Optional.of(lead));

        WorkspaceBillingConfig cfg = new WorkspaceBillingConfig();
        cfg.setWorkspaceId(workspaceId);
        cfg.setCostMode(CostMode.PAY_PER_USER);
        when(creditService.getWorkspaceBillingConfig(workspaceId)).thenReturn(cfg);

        WorkspaceBillingConfigResponse getResp = workspaceService.getBillingConfig(workspaceId, leadUserId);
        assertEquals(CostMode.PAY_PER_USER, getResp.costMode());

        WorkspaceBillingConfig updatedCfg = new WorkspaceBillingConfig();
        updatedCfg.setWorkspaceId(workspaceId);
        updatedCfg.setCostMode(CostMode.LEAD_PAYS_ALL);
        when(creditService.updateCostMode(eq(workspaceId), eq(leadUserId), eq(CostMode.LEAD_PAYS_ALL)))
                .thenReturn(updatedCfg);

        WorkspaceBillingConfigResponse updateResp = workspaceService.updateBillingConfig(
                workspaceId, leadUserId, new UpdateBillingConfigRequest(CostMode.LEAD_PAYS_ALL));
        assertEquals(CostMode.LEAD_PAYS_ALL, updateResp.costMode());
    }
}
