package com.app.modules.workspace.service.impl;

import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.Workspace;
import com.app.modules.workspace.entity.WorkspaceMember;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import com.app.modules.workspace.service.WorkspaceService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

@Service
public class WorkspaceServiceImpl implements WorkspaceService {

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;

    public WorkspaceServiceImpl(WorkspaceRepository workspaceRepository,
                                WorkspaceMemberRepository workspaceMemberRepository) {
        this.workspaceRepository = workspaceRepository;
        this.workspaceMemberRepository = workspaceMemberRepository;
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
