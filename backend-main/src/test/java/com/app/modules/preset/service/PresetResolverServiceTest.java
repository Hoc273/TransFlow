package com.app.modules.preset.service;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.preset.entity.MediaPreset;
import com.app.modules.preset.entity.MediaPresetScope;
import com.app.modules.preset.repository.MediaPresetRepository;
import com.app.modules.preset.service.impl.PresetResolverServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PresetResolverServiceTest {

    @Mock
    private MediaPresetRepository mediaPresetRepository;

    private PresetResolverService service;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final UUID presetId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new PresetResolverServiceImpl(mediaPresetRepository);
    }

    private MediaPreset createMockPreset(UUID id, MediaPresetScope scope, UUID wsId, UUID pId, boolean active, boolean isDefault) {
        MediaPreset preset = new MediaPreset();
        preset.setId(id);
        preset.setScope(scope);
        preset.setWorkspaceId(wsId);
        preset.setProjectId(pId);
        preset.setActive(active);
        preset.setDefault(isDefault);
        preset.setName("Mock Preset");
        return preset;
    }

    @Test
    @DisplayName("Explicit SYSTEM preset returns preset id")
    void explicitSystemPreset_returnsId() {
        MediaPreset preset = createMockPreset(presetId, MediaPresetScope.SYSTEM, null, null, true, false);
        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.of(preset));

        UUID resolved = service.resolveForJobCreation(presetId, projectId, workspaceId);
        assertThat(resolved).isEqualTo(presetId);
    }

    @Test
    @DisplayName("Explicit WORKSPACE preset in matching workspace returns preset id")
    void explicitWorkspacePreset_matchingWorkspace_returnsId() {
        MediaPreset preset = createMockPreset(presetId, MediaPresetScope.WORKSPACE, workspaceId, null, true, false);
        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.of(preset));

        UUID resolved = service.resolveForJobCreation(presetId, projectId, workspaceId);
        assertThat(resolved).isEqualTo(presetId);
    }

    @Test
    @DisplayName("Explicit WORKSPACE preset in different workspace throws PRESET_NOT_FOUND")
    void explicitWorkspacePreset_differentWorkspace_throwsNotFound() {
        MediaPreset preset = createMockPreset(presetId, MediaPresetScope.WORKSPACE, UUID.randomUUID(), null, true, false);
        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.of(preset));

        assertThatThrownBy(() -> service.resolveForJobCreation(presetId, projectId, workspaceId))
                .isInstanceOf(AppException.class)
                .satisfies(ex -> assertThat(((AppException) ex).getErrorCode()).isEqualTo(ErrorCode.PRESET_NOT_FOUND));
    }

    @Test
    @DisplayName("Explicit PROJECT preset in matching project returns preset id")
    void explicitProjectPreset_matchingProject_returnsId() {
        MediaPreset preset = createMockPreset(presetId, MediaPresetScope.PROJECT, workspaceId, projectId, true, false);
        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.of(preset));

        UUID resolved = service.resolveForJobCreation(presetId, projectId, workspaceId);
        assertThat(resolved).isEqualTo(presetId);
    }

    @Test
    @DisplayName("Explicit PROJECT preset in different project throws PRESET_NOT_FOUND")
    void explicitProjectPreset_differentProject_throwsNotFound() {
        MediaPreset preset = createMockPreset(presetId, MediaPresetScope.PROJECT, workspaceId, UUID.randomUUID(), true, false);
        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.of(preset));

        assertThatThrownBy(() -> service.resolveForJobCreation(presetId, projectId, workspaceId))
                .isInstanceOf(AppException.class)
                .satisfies(ex -> assertThat(((AppException) ex).getErrorCode()).isEqualTo(ErrorCode.PRESET_NOT_FOUND));
    }

    @Test
    @DisplayName("Explicit inactive preset throws PRESET_INACTIVE")
    void explicitPreset_inactive_throwsInactive() {
        MediaPreset preset = createMockPreset(presetId, MediaPresetScope.SYSTEM, null, null, false, false);
        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.of(preset));

        assertThatThrownBy(() -> service.resolveForJobCreation(presetId, projectId, workspaceId))
                .isInstanceOf(AppException.class)
                .satisfies(ex -> assertThat(((AppException) ex).getErrorCode()).isEqualTo(ErrorCode.PRESET_INACTIVE));
    }

    @Test
    @DisplayName("Explicit non-existent preset throws PRESET_NOT_FOUND")
    void explicitPreset_notFound_throwsNotFound() {
        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.resolveForJobCreation(presetId, projectId, workspaceId))
                .isInstanceOf(AppException.class)
                .satisfies(ex -> assertThat(((AppException) ex).getErrorCode()).isEqualTo(ErrorCode.PRESET_NOT_FOUND));
    }

    @Test
    @DisplayName("Fallback hierarchy: Level 2 Project default wins when explicit is null")
    void fallbackHierarchy_projectDefaultWins() {
        UUID projectDefaultId = UUID.randomUUID();
        MediaPreset projectPreset = createMockPreset(projectDefaultId, MediaPresetScope.PROJECT, workspaceId, projectId, true, true);

        when(mediaPresetRepository.findFirstByScopeAndProjectIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope.PROJECT, projectId))
                .thenReturn(Optional.of(projectPreset));

        UUID resolved = service.resolveForJobCreation(null, projectId, workspaceId);
        assertThat(resolved).isEqualTo(projectDefaultId);
    }

    @Test
    @DisplayName("Fallback hierarchy: Level 3 Workspace default wins when project default not found")
    void fallbackHierarchy_workspaceDefaultWins() {
        UUID workspaceDefaultId = UUID.randomUUID();
        MediaPreset wsPreset = createMockPreset(workspaceDefaultId, MediaPresetScope.WORKSPACE, workspaceId, null, true, true);

        when(mediaPresetRepository.findFirstByScopeAndProjectIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope.PROJECT, projectId))
                .thenReturn(Optional.empty());
        when(mediaPresetRepository.findFirstByScopeAndWorkspaceIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope.WORKSPACE, workspaceId))
                .thenReturn(Optional.of(wsPreset));

        UUID resolved = service.resolveForJobCreation(null, projectId, workspaceId);
        assertThat(resolved).isEqualTo(workspaceDefaultId);
    }

    @Test
    @DisplayName("Fallback hierarchy: Level 4 System default wins when project and workspace defaults not found")
    void fallbackHierarchy_systemDefaultWins() {
        UUID systemDefaultId = UUID.randomUUID();
        MediaPreset sysPreset = createMockPreset(systemDefaultId, MediaPresetScope.SYSTEM, null, null, true, true);

        when(mediaPresetRepository.findFirstByScopeAndProjectIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope.PROJECT, projectId))
                .thenReturn(Optional.empty());
        when(mediaPresetRepository.findFirstByScopeAndWorkspaceIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope.WORKSPACE, workspaceId))
                .thenReturn(Optional.empty());
        when(mediaPresetRepository.findFirstByScopeAndIsDefaultTrueAndActiveTrue(MediaPresetScope.SYSTEM))
                .thenReturn(Optional.of(sysPreset));

        UUID resolved = service.resolveForJobCreation(null, projectId, workspaceId);
        assertThat(resolved).isEqualTo(systemDefaultId);
    }

    @Test
    @DisplayName("Fallback hierarchy: Level 5 returns null when no defaults exist anywhere")
    void fallbackHierarchy_noDefaults_returnsNull() {
        when(mediaPresetRepository.findFirstByScopeAndProjectIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope.PROJECT, projectId))
                .thenReturn(Optional.empty());
        when(mediaPresetRepository.findFirstByScopeAndWorkspaceIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope.WORKSPACE, workspaceId))
                .thenReturn(Optional.empty());
        when(mediaPresetRepository.findFirstByScopeAndIsDefaultTrueAndActiveTrue(MediaPresetScope.SYSTEM))
                .thenReturn(Optional.empty());

        UUID resolved = service.resolveForJobCreation(null, projectId, workspaceId);
        assertThat(resolved).isNull();
    }
}
