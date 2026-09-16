package com.app.modules.workspace.service.impl;

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
import com.app.modules.workspace.service.WorkspaceService;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.text.Normalizer;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class WorkspaceServiceImpl implements WorkspaceService {

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final AuthService authService;
    private final CreditService creditService;
    private final ProjectService projectService;

    public WorkspaceServiceImpl(WorkspaceRepository workspaceRepository,
                                WorkspaceMemberRepository workspaceMemberRepository,
                                @Lazy AuthService authService,
                                CreditService creditService,
                                @Lazy ProjectService projectService) {
        this.workspaceRepository = workspaceRepository;
        this.workspaceMemberRepository = workspaceMemberRepository;
        this.authService = authService;
        this.creditService = creditService;
        this.projectService = projectService;
    }

    @Override
    @Transactional
    public Workspace createDefaultWorkspace(UUID userId, String fullName) {
        String baseName = (fullName != null && !fullName.isBlank())
                ? fullName.trim() + "'s Workspace"
                : "Personal Workspace";

        String slug = generateUniqueSlug(baseName);

        Workspace workspace = new Workspace();
        workspace.setName(baseName);
        workspace.setSlug(slug);
        workspace.setOwnerUserId(userId);
        workspaceRepository.save(workspace);

        WorkspaceMember leadMember = new WorkspaceMember();
        leadMember.setWorkspaceId(workspace.getId());
        leadMember.setUserId(userId);
        leadMember.setRole(Role.LEAD);
        workspaceMemberRepository.save(leadMember);

        return workspace;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<UUID> findDefaultWorkspaceIdForUser(UUID userId) {
        List<WorkspaceMember> memberships = workspaceMemberRepository.findByUserId(userId);
        if (memberships.isEmpty()) {
            return Optional.empty();
        }

        // Prefer workspace where user is LEAD, otherwise first membership
        UUID workspaceId = memberships.stream()
                .filter(m -> m.getRole() == Role.LEAD)
                .map(WorkspaceMember::getWorkspaceId)
                .findFirst()
                .orElse(memberships.getFirst().getWorkspaceId());

        return Optional.of(workspaceId);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Workspace> findById(UUID workspaceId) {
        return workspaceRepository.findById(workspaceId);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Role> getRole(UUID workspaceId, UUID userId) {
        return workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId)
                .map(WorkspaceMember::getRole);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean isMember(UUID workspaceId, UUID userId) {
        return workspaceMemberRepository.existsByWorkspaceIdAndUserId(workspaceId, userId);
    }

    @Override
    @Transactional
    public WorkspaceResponse create(UUID userId, CreateWorkspaceRequest req) {
        String slug;
        if (req.slug() != null && !req.slug().isBlank()) {
            slug = req.slug().trim().toLowerCase(Locale.ROOT);
            if (workspaceRepository.existsBySlug(slug)) {
                throw new AppException(ErrorCode.WORKSPACE_SLUG_ALREADY_EXISTS);
            }
        } else {
            slug = generateUniqueSlug(req.name());
        }

        Workspace workspace = new Workspace();
        workspace.setName(req.name().trim());
        workspace.setSlug(slug);
        workspace.setOwnerUserId(userId);
        workspaceRepository.save(workspace);

        WorkspaceMember leadMember = new WorkspaceMember();
        leadMember.setWorkspaceId(workspace.getId());
        leadMember.setUserId(userId);
        leadMember.setRole(Role.LEAD);
        workspaceMemberRepository.save(leadMember);

        // Auto-init workspace billing config
        creditService.initWorkspaceBillingConfig(workspace.getId(), userId, CostMode.PAY_PER_USER);

        // Auto-init default project for this workspace
        projectService.createDefaultProject(workspace.getId());

        return WorkspaceResponse.from(workspace, Role.LEAD);
    }

    @Override
    @Transactional(readOnly = true)
    public List<WorkspaceResponse> listForUser(UUID userId) {
        List<WorkspaceMember> memberships = workspaceMemberRepository.findByUserId(userId);
        if (memberships.isEmpty()) {
            return Collections.emptyList();
        }

        Map<UUID, Role> roleMap = memberships.stream()
                .collect(Collectors.toMap(WorkspaceMember::getWorkspaceId, WorkspaceMember::getRole, (r1, r2) -> r1));

        return workspaceRepository.findAllById(roleMap.keySet()).stream()
                .map(ws -> WorkspaceResponse.from(ws, roleMap.get(ws.getId())))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public WorkspaceResponse get(UUID workspaceId, UUID userId) {
        Role role = requireMembership(workspaceId, userId);
        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new AppException(ErrorCode.WORKSPACE_NOT_FOUND));
        return WorkspaceResponse.from(ws, role);
    }

    @Override
    @Transactional(readOnly = true)
    public List<WorkspaceMemberResponse> listMembers(UUID workspaceId, UUID userId) {
        requireMembership(workspaceId, userId);

        List<WorkspaceMember> members = workspaceMemberRepository.findByWorkspaceId(workspaceId);
        Set<UUID> userIds = members.stream().map(WorkspaceMember::getUserId).collect(Collectors.toSet());
        Map<UUID, UserResponse> userMap = authService.findUsersByIds(userIds);

        return members.stream().map(m -> {
            UserResponse u = userMap.get(m.getUserId());
            return new WorkspaceMemberResponse(
                    m.getId(),
                    m.getUserId(),
                    u != null ? u.email() : null,
                    u != null ? u.fullName() : null,
                    m.getRole(),
                    m.getCreatedAt()
            );
        }).toList();
    }

    @Override
    @Transactional
    public WorkspaceMemberResponse addMember(UUID workspaceId, UUID actingUserId, AddWorkspaceMemberRequest req) {
        requireLead(workspaceId, actingUserId);

        if (req.role() == Role.LEAD) {
            throw new AppException(ErrorCode.CANNOT_ASSIGN_LEAD_ROLE);
        }

        UserResponse targetUser = authService.findUserByEmail(req.email())
                .orElseThrow(() -> new AppException(ErrorCode.USER_NOT_FOUND));

        if (workspaceMemberRepository.existsByWorkspaceIdAndUserId(workspaceId, targetUser.id())) {
            throw new AppException(ErrorCode.WORKSPACE_MEMBER_ALREADY_EXISTS);
        }

        WorkspaceMember member = new WorkspaceMember();
        member.setWorkspaceId(workspaceId);
        member.setUserId(targetUser.id());
        member.setRole(req.role());
        workspaceMemberRepository.save(member);

        return new WorkspaceMemberResponse(
                member.getId(),
                targetUser.id(),
                targetUser.email(),
                targetUser.fullName(),
                member.getRole(),
                member.getCreatedAt()
        );
    }

    @Override
    @Transactional
    public WorkspaceMemberResponse updateMemberRole(UUID workspaceId, UUID actingUserId, UUID memberId, UpdateMemberRoleRequest req) {
        requireLead(workspaceId, actingUserId);

        if (req.role() == Role.LEAD) {
            throw new AppException(ErrorCode.CANNOT_ASSIGN_LEAD_ROLE);
        }

        WorkspaceMember member = workspaceMemberRepository.findById(memberId)
                .filter(m -> m.getWorkspaceId().equals(workspaceId))
                .orElseThrow(() -> new AppException(ErrorCode.WORKSPACE_MEMBER_NOT_FOUND));

        if (member.getRole() == Role.LEAD) {
            throw new AppException(ErrorCode.LEAD_CANNOT_BE_REMOVED);
        }

        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new AppException(ErrorCode.WORKSPACE_NOT_FOUND));
        if (ws.getOwnerUserId().equals(member.getUserId())) {
            throw new AppException(ErrorCode.LEAD_CANNOT_BE_REMOVED);
        }

        member.setRole(req.role());
        workspaceMemberRepository.save(member);

        UserResponse u = authService.findUserById(member.getUserId()).orElse(null);
        return new WorkspaceMemberResponse(
                member.getId(),
                member.getUserId(),
                u != null ? u.email() : null,
                u != null ? u.fullName() : null,
                member.getRole(),
                member.getCreatedAt()
        );
    }

    @Override
    @Transactional
    public void removeMember(UUID workspaceId, UUID actingUserId, UUID memberId) {
        requireLead(workspaceId, actingUserId);

        WorkspaceMember member = workspaceMemberRepository.findById(memberId)
                .filter(m -> m.getWorkspaceId().equals(workspaceId))
                .orElseThrow(() -> new AppException(ErrorCode.WORKSPACE_MEMBER_NOT_FOUND));

        if (member.getRole() == Role.LEAD) {
            throw new AppException(ErrorCode.LEAD_CANNOT_BE_REMOVED);
        }

        Workspace ws = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new AppException(ErrorCode.WORKSPACE_NOT_FOUND));
        if (ws.getOwnerUserId().equals(member.getUserId())) {
            throw new AppException(ErrorCode.LEAD_CANNOT_BE_REMOVED);
        }

        // Cascade remove from project_members in this workspace
        projectService.removeMemberFromAllProjectsInWorkspace(workspaceId, member.getUserId());

        workspaceMemberRepository.delete(member);
    }

    @Override
    @Transactional(readOnly = true)
    public WorkspaceBillingConfigResponse getBillingConfig(UUID workspaceId, UUID userId) {
        requireMembership(workspaceId, userId);
        WorkspaceBillingConfig config = creditService.getWorkspaceBillingConfig(workspaceId);
        return new WorkspaceBillingConfigResponse(config.getCostMode());
    }

    @Override
    @Transactional
    public WorkspaceBillingConfigResponse updateBillingConfig(UUID workspaceId, UUID actingUserId, UpdateBillingConfigRequest req) {
        requireLead(workspaceId, actingUserId);
        WorkspaceBillingConfig updated = creditService.updateCostMode(workspaceId, actingUserId, req.costMode());
        return new WorkspaceBillingConfigResponse(updated.getCostMode());
    }

    private Role requireMembership(UUID workspaceId, UUID userId) {
        return workspaceMemberRepository.findByWorkspaceIdAndUserId(workspaceId, userId)
                .map(WorkspaceMember::getRole)
                .orElseThrow(() -> new AppException(ErrorCode.UNAUTHORIZED));
    }

    private void requireLead(UUID workspaceId, UUID userId) {
        Role role = requireMembership(workspaceId, userId);
        if (role != Role.LEAD) {
            throw new AppException(ErrorCode.UNAUTHORIZED);
        }
    }

    private String generateUniqueSlug(String name) {
        String base = slugify(name);
        if (base.isBlank()) {
            base = "workspace";
        }
        String slug = base;
        int attempt = 1;
        while (workspaceRepository.existsBySlug(slug)) {
            slug = base + "-" + UUID.randomUUID().toString().substring(0, 6);
            attempt++;
            if (attempt > 10) {
                slug = "ws-" + UUID.randomUUID();
                break;
            }
        }
        return slug;
    }

    private static String slugify(String input) {
        if (input == null) return "";
        String normalized = Normalizer.normalize(input, Normalizer.Form.NFD);
        String noMarks = normalized.replaceAll("\\p{M}", "");
        String slug = noMarks.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return slug.length() > 80 ? slug.substring(0, 80) : slug;
    }
}
