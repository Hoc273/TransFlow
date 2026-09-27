package com.app.modules.preset.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.preset.dto.CreateMediaPresetRequest;
import com.app.modules.preset.dto.MediaPresetResponse;
import com.app.modules.preset.dto.UpdateMediaPresetRequest;
import com.app.modules.preset.entity.MediaPreset;
import com.app.modules.preset.entity.MediaPresetScope;
import com.app.modules.preset.repository.MediaPresetRepository;
import com.app.modules.preset.service.PresetService;
import com.app.modules.project.dto.ProjectResponse;
import com.app.modules.project.entity.Project;
import com.app.modules.project.service.ProjectService;
import com.app.modules.workspace.service.WorkspaceAccessService;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class PresetServiceImpl implements PresetService {

    private final MediaPresetRepository mediaPresetRepository;
    private final WorkspaceAccessService workspaceAccessService;
    private final ProjectService projectService;

    public PresetServiceImpl(MediaPresetRepository mediaPresetRepository,
                             WorkspaceAccessService workspaceAccessService,
                             ProjectService projectService) {
        this.mediaPresetRepository = mediaPresetRepository;
        this.workspaceAccessService = workspaceAccessService;
        this.projectService = projectService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<MediaPresetResponse> listPresets(UUID workspaceId, UUID userId, String scopeStr, UUID projectId) {
        workspaceAccessService.getRole(workspaceId, userId);

        if (projectId != null) {
            workspaceAccessService.requireProjectAccess(workspaceId, userId, projectId);
            Project project = projectService.findById(projectId)
                    .orElseThrow(() -> new AppException(ErrorCode.PROJECT_NOT_FOUND));
            if (!workspaceId.equals(project.getWorkspaceId())) {
                throw new AppException(ErrorCode.PROJECT_NOT_FOUND);
            }
        }

        MediaPresetScope scopeFilter = null;
        if (scopeStr != null && !scopeStr.isBlank()) {
            try {
                scopeFilter = MediaPresetScope.valueOf(scopeStr.trim().toUpperCase());
            } catch (IllegalArgumentException ex) {
                throw new AppException(ErrorCode.PRESET_SCOPE_INVALID);
            }
        }

        List<MediaPreset> presets;

        if (scopeFilter != null) {
            switch (scopeFilter) {
                case SYSTEM -> presets = mediaPresetRepository.findByScopeAndActiveTrue(MediaPresetScope.SYSTEM);
                case WORKSPACE -> presets = mediaPresetRepository.findByScopeAndWorkspaceId(MediaPresetScope.WORKSPACE, workspaceId);
                case PROJECT -> {
                    if (projectId != null) {
                        presets = mediaPresetRepository.findByScopeAndProjectId(MediaPresetScope.PROJECT, projectId);
                    } else {
                        List<UUID> projectIds = projectService.listProjects(workspaceId, userId)
                                .stream().map(ProjectResponse::id).toList();
                        presets = projectIds.isEmpty()
                                ? Collections.emptyList()
                                : mediaPresetRepository.findAll().stream()
                                    .filter(p -> p.getScope() == MediaPresetScope.PROJECT
                                            && p.isActive()
                                            && p.getProjectId() != null
                                            && projectIds.contains(p.getProjectId()))
                                    .toList();
                    }
                }
                default -> presets = Collections.emptyList();
            }
        } else {
            List<UUID> accessibleProjectIds;
            if (projectId != null) {
                accessibleProjectIds = List.of(projectId);
            } else {
                accessibleProjectIds = projectService.listProjects(workspaceId, userId)
                        .stream().map(ProjectResponse::id).toList();
            }

            if (accessibleProjectIds.isEmpty()) {
                presets = mediaPresetRepository.findAvailablePresetsNoProjects(workspaceId);
            } else {
                presets = mediaPresetRepository.findAvailablePresets(workspaceId, accessibleProjectIds);
            }
        }

        // Sort: PROJECT first, then WORKSPACE, then SYSTEM.
        // Within each scope: default first (isDefault DESC), then createdAt ASC
        Comparator<MediaPreset> comparator = Comparator
                .comparingInt((MediaPreset p) -> scopePriority(p.getScope()))
                .thenComparing(MediaPreset::isDefault, Comparator.reverseOrder())
                .thenComparing(MediaPreset::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder()));

        return presets.stream()
                .sorted(comparator)
                .map(MediaPresetResponse::from)
                .toList();
    }

    private static int scopePriority(MediaPresetScope scope) {
        if (scope == null) return 4;
        return switch (scope) {
            case PROJECT -> 1;
            case WORKSPACE -> 2;
            case SYSTEM -> 3;
        };
    }

    @Override
    @Transactional(readOnly = true)
    public MediaPresetResponse getPreset(UUID workspaceId, UUID userId, UUID presetId) {
        workspaceAccessService.getRole(workspaceId, userId);

        MediaPreset preset = mediaPresetRepository.findById(presetId)
                .orElseThrow(() -> new AppException(ErrorCode.PRESET_NOT_FOUND));

        if (preset.getScope() == MediaPresetScope.WORKSPACE) {
            if (!workspaceId.equals(preset.getWorkspaceId())) {
                throw new AppException(ErrorCode.PRESET_NOT_FOUND);
            }
        } else if (preset.getScope() == MediaPresetScope.PROJECT) {
            if (preset.getWorkspaceId() != null && !workspaceId.equals(preset.getWorkspaceId())) {
                throw new AppException(ErrorCode.PRESET_NOT_FOUND);
            }
            workspaceAccessService.requireProjectAccess(workspaceId, userId, preset.getProjectId());
        }

        return MediaPresetResponse.from(preset);
    }

    @Override
    @Transactional(readOnly = true)
    public List<MediaPresetResponse> listTemplates() {
        return mediaPresetRepository.findByScopeAndActiveTrueOrderByNameAsc(MediaPresetScope.SYSTEM)
                .stream()
                .map(MediaPresetResponse::from)
                .toList();
    }

    @Override
    @Transactional
    public MediaPresetResponse createPreset(UUID workspaceId, UUID userId, CreateMediaPresetRequest request) {
        MediaPresetScope scope;
        try {
            scope = MediaPresetScope.valueOf(request.scope().trim().toUpperCase());
        } catch (Exception ex) {
            throw new AppException(ErrorCode.PRESET_SCOPE_INVALID);
        }

        if (scope == MediaPresetScope.SYSTEM) {
            throw new AppException(ErrorCode.SYSTEM_PRESET_READ_ONLY);
        }

        UUID projectId = null;
        if (scope == MediaPresetScope.WORKSPACE) {
            workspaceAccessService.requireWorkspaceLead(workspaceId, userId);
        } else if (scope == MediaPresetScope.PROJECT) {
            if (request.projectId() == null) {
                throw new AppException(ErrorCode.PRESET_SCOPE_INVALID);
            }
            Project project = projectService.findById(request.projectId())
                    .orElseThrow(() -> new AppException(ErrorCode.PROJECT_NOT_FOUND));
            if (!workspaceId.equals(project.getWorkspaceId())) {
                throw new AppException(ErrorCode.PROJECT_NOT_FOUND);
            }
            workspaceAccessService.requireProjectWriteAccess(workspaceId, userId, request.projectId());
            projectId = request.projectId();
        }

        boolean isDefault = Boolean.TRUE.equals(request.isDefault());
        if (isDefault) {
            if (scope == MediaPresetScope.WORKSPACE) {
                mediaPresetRepository.findFirstByScopeAndWorkspaceIdAndIsDefaultTrue(MediaPresetScope.WORKSPACE, workspaceId)
                        .ifPresent(oldDefault -> {
                            oldDefault.setDefault(false);
                            mediaPresetRepository.save(oldDefault);
                        });
            } else {
                mediaPresetRepository.findFirstByScopeAndProjectIdAndIsDefaultTrue(MediaPresetScope.PROJECT, projectId)
                        .ifPresent(oldDefault -> {
                            oldDefault.setDefault(false);
                            mediaPresetRepository.save(oldDefault);
                        });
            }
        }

        MediaPreset preset = new MediaPreset();
        preset.setScope(scope);
        preset.setWorkspaceId(workspaceId);
        preset.setProjectId(projectId);
        preset.setName(request.name().trim());
        preset.setSubtitleStyle(request.subtitleStyle());
        preset.setVoiceConfig(request.voiceConfig() != null ? request.voiceConfig() : JsonNodeFactory.instance.objectNode());
        preset.setRenderConfig(request.renderConfig() != null ? request.renderConfig() : JsonNodeFactory.instance.objectNode());
        preset.setDefault(isDefault);
        preset.setActive(true);
        preset.setCreatedBy(userId);
        preset.setUpdatedBy(userId);

        MediaPreset saved = mediaPresetRepository.save(preset);
        return MediaPresetResponse.from(saved);
    }

    @Override
    @Transactional
    public MediaPresetResponse updatePreset(UUID workspaceId, UUID userId, UUID presetId, UpdateMediaPresetRequest request) {
        MediaPreset preset = mediaPresetRepository.findById(presetId)
                .orElseThrow(() -> new AppException(ErrorCode.PRESET_NOT_FOUND));

        if (preset.getScope() == MediaPresetScope.SYSTEM) {
            throw new AppException(ErrorCode.SYSTEM_PRESET_READ_ONLY);
        }

        if (!workspaceId.equals(preset.getWorkspaceId())) {
            throw new AppException(ErrorCode.PRESET_NOT_FOUND);
        }

        if (preset.getScope() == MediaPresetScope.WORKSPACE) {
            workspaceAccessService.requireWorkspaceLead(workspaceId, userId);
        } else if (preset.getScope() == MediaPresetScope.PROJECT) {
            workspaceAccessService.requireProjectWriteAccess(workspaceId, userId, preset.getProjectId());
        }

        if (Boolean.TRUE.equals(request.isDefault()) && !preset.isDefault()) {
            if (preset.getScope() == MediaPresetScope.WORKSPACE) {
                mediaPresetRepository.findFirstByScopeAndWorkspaceIdAndIsDefaultTrue(MediaPresetScope.WORKSPACE, workspaceId)
                        .filter(other -> !other.getId().equals(presetId))
                        .ifPresent(oldDefault -> {
                            oldDefault.setDefault(false);
                            mediaPresetRepository.save(oldDefault);
                        });
            } else if (preset.getScope() == MediaPresetScope.PROJECT) {
                mediaPresetRepository.findFirstByScopeAndProjectIdAndIsDefaultTrue(MediaPresetScope.PROJECT, preset.getProjectId())
                        .filter(other -> !other.getId().equals(presetId))
                        .ifPresent(oldDefault -> {
                            oldDefault.setDefault(false);
                            mediaPresetRepository.save(oldDefault);
                        });
            }
            preset.setDefault(true);
        } else if (Boolean.FALSE.equals(request.isDefault())) {
            preset.setDefault(false);
        }

        if (request.name() != null && !request.name().isBlank()) {
            preset.setName(request.name().trim());
        }
        if (request.subtitleStyle() != null) {
            preset.setSubtitleStyle(request.subtitleStyle());
        }
        if (request.voiceConfig() != null) {
            preset.setVoiceConfig(request.voiceConfig());
        }
        if (request.renderConfig() != null) {
            preset.setRenderConfig(request.renderConfig());
        }
        if (request.active() != null) {
            preset.setActive(request.active());
        }
        preset.setUpdatedBy(userId);

        MediaPreset saved = mediaPresetRepository.save(preset);
        return MediaPresetResponse.from(saved);
    }

    @Override
    @Transactional
    public void deletePreset(UUID workspaceId, UUID userId, UUID presetId, UUID replacementPresetId) {
        MediaPreset preset = mediaPresetRepository.findById(presetId)
                .orElseThrow(() -> new AppException(ErrorCode.PRESET_NOT_FOUND));

        if (preset.getScope() == MediaPresetScope.SYSTEM) {
            throw new AppException(ErrorCode.SYSTEM_PRESET_READ_ONLY);
        }

        if (!workspaceId.equals(preset.getWorkspaceId())) {
            throw new AppException(ErrorCode.PRESET_NOT_FOUND);
        }

        if (preset.getScope() == MediaPresetScope.WORKSPACE) {
            workspaceAccessService.requireWorkspaceLead(workspaceId, userId);
        } else if (preset.getScope() == MediaPresetScope.PROJECT) {
            workspaceAccessService.requireProjectWriteAccess(workspaceId, userId, preset.getProjectId());
        }

        if (preset.isDefault()) {
            if (replacementPresetId == null) {
                throw new AppException(ErrorCode.CANNOT_DELETE_ONLY_DEFAULT_PRESET);
            }
            if (replacementPresetId.equals(presetId)) {
                throw new AppException(ErrorCode.REPLACEMENT_PRESET_INVALID);
            }
            MediaPreset replacement = mediaPresetRepository.findById(replacementPresetId)
                    .orElseThrow(() -> new AppException(ErrorCode.REPLACEMENT_PRESET_INVALID));

            if (!replacement.isActive() || replacement.getScope() != preset.getScope()) {
                throw new AppException(ErrorCode.REPLACEMENT_PRESET_INVALID);
            }
            if (preset.getScope() == MediaPresetScope.WORKSPACE && !workspaceId.equals(replacement.getWorkspaceId())) {
                throw new AppException(ErrorCode.REPLACEMENT_PRESET_INVALID);
            }
            if (preset.getScope() == MediaPresetScope.PROJECT && !Objects.equals(preset.getProjectId(), replacement.getProjectId())) {
                throw new AppException(ErrorCode.REPLACEMENT_PRESET_INVALID);
            }

            replacement.setDefault(true);
            replacement.setUpdatedBy(userId);
            mediaPresetRepository.save(replacement);
        }

        mediaPresetRepository.delete(preset);
    }
}
