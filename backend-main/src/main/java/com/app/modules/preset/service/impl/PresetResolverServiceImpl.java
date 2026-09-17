package com.app.modules.preset.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.preset.entity.MediaPreset;
import com.app.modules.preset.entity.MediaPresetScope;
import com.app.modules.preset.repository.MediaPresetRepository;
import com.app.modules.preset.service.PresetResolverService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * Resolver service implementation provided by Member A for Member B (CLAUDE_A.md §8.4, Backend_Java_TaskSplit_MemberA.md §2.5).
 * Resolution hierarchy (SRS §5.7, API_Contract.md §9):
 * 1. explicitPresetId (if provided: validates existence, active status, scope and workspace/project ownership)
 * 2. Project default (scope = PROJECT, project_id = projectId, is_default = true, active = true)
 * 3. Workspace default (scope = WORKSPACE, workspace_id = workspaceId, is_default = true, active = true)
 * 4. System default (scope = SYSTEM, is_default = true, active = true)
 * 5. Returns null if none found.
 */
@Service
public class PresetResolverServiceImpl implements PresetResolverService {

    private final MediaPresetRepository mediaPresetRepository;

    public PresetResolverServiceImpl(MediaPresetRepository mediaPresetRepository) {
        this.mediaPresetRepository = mediaPresetRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public UUID resolveForJobCreation(UUID explicitPresetId, UUID projectId, UUID workspaceId) {
        if (explicitPresetId != null) {
            MediaPreset preset = mediaPresetRepository.findById(explicitPresetId)
                    .orElseThrow(() -> new AppException(ErrorCode.PRESET_NOT_FOUND));

            if (!preset.isActive()) {
                throw new AppException(ErrorCode.PRESET_INACTIVE);
            }

            if (preset.getScope() == MediaPresetScope.WORKSPACE) {
                if (!Objects.equals(workspaceId, preset.getWorkspaceId())) {
                    throw new AppException(ErrorCode.PRESET_NOT_FOUND);
                }
            } else if (preset.getScope() == MediaPresetScope.PROJECT) {
                if (!Objects.equals(projectId, preset.getProjectId())) {
                    throw new AppException(ErrorCode.PRESET_NOT_FOUND);
                }
                if (preset.getWorkspaceId() != null && !Objects.equals(workspaceId, preset.getWorkspaceId())) {
                    throw new AppException(ErrorCode.PRESET_NOT_FOUND);
                }
            }

            return preset.getId();
        }

        // Hierarchy level 2: Project default
        if (projectId != null) {
            var projectDefault = mediaPresetRepository
                    .findFirstByScopeAndProjectIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope.PROJECT, projectId);
            if (projectDefault.isPresent()) {
                return projectDefault.get().getId();
            }
        }

        // Hierarchy level 3: Workspace default
        if (workspaceId != null) {
            var workspaceDefault = mediaPresetRepository
                    .findFirstByScopeAndWorkspaceIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope.WORKSPACE, workspaceId);
            if (workspaceDefault.isPresent()) {
                return workspaceDefault.get().getId();
            }
        }

        // Hierarchy level 4: System default
        var systemDefault = mediaPresetRepository
                .findFirstByScopeAndIsDefaultTrueAndActiveTrue(MediaPresetScope.SYSTEM);
        if (systemDefault.isPresent()) {
            return systemDefault.get().getId();
        }

        // Hierarchy level 5: Fallback to null (recipe default in MediaJob)
        return null;
    }
}
