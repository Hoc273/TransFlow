package com.app.modules.preset.service;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.preset.dto.CreateMediaPresetRequest;
import com.app.modules.preset.dto.MediaPresetResponse;
import com.app.modules.preset.dto.UpdateMediaPresetRequest;
import com.app.modules.preset.entity.MediaPreset;
import com.app.modules.preset.entity.MediaPresetScope;
import com.app.modules.preset.repository.MediaPresetRepository;
import com.app.modules.preset.service.impl.PresetServiceImpl;
import com.app.modules.project.dto.ProjectResponse;
import com.app.modules.project.entity.Project;
import com.app.modules.project.service.ProjectService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PresetServiceTest {

    @Mock
    private MediaPresetRepository mediaPresetRepository;

    @Mock
    private WorkspaceAccessService workspaceAccessService;

    @Mock
    private ProjectService projectService;

    private PresetService presetService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final UUID presetId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        presetService = new PresetServiceImpl(mediaPresetRepository, workspaceAccessService, projectService);
    }

    private MediaPreset createPreset(UUID id, MediaPresetScope scope, UUID wsId, UUID pId, boolean active, boolean isDefault) {
        MediaPreset p = new MediaPreset();
        p.setId(id);
        p.setScope(scope);
        p.setWorkspaceId(wsId);
        p.setProjectId(pId);
        p.setName("Preset " + id);
        p.setSubtitleStyle(objectMapper.createObjectNode());
        p.setVoiceConfig(objectMapper.createObjectNode());
        p.setRenderConfig(objectMapper.createObjectNode());
        p.setActive(active);
        p.setDefault(isDefault);
        p.setCreatedAt(Instant.now());
        p.setUpdatedAt(Instant.now());
        return p;
    }

    @Test
    @DisplayName("listPresets with scope filter SYSTEM returns active SYSTEM presets")
    void listPresets_scopeSystem_returnsSystemPresets() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.LEAD);
        MediaPreset sysPreset = createPreset(presetId, MediaPresetScope.SYSTEM, null, null, true, true);
        when(mediaPresetRepository.findByScopeAndActiveTrue(MediaPresetScope.SYSTEM)).thenReturn(List.of(sysPreset));

        List<MediaPresetResponse> result = presetService.listPresets(workspaceId, userId, "SYSTEM", null);
        assertThat(result).hasSize(1);
        assertThat(result.get(0).id()).isEqualTo(presetId);
    }

    @Test
    @DisplayName("listPresets with invalid scope string throws PRESET_SCOPE_INVALID")
    void listPresets_invalidScope_throwsInvalid() {
        when(workspaceAccessService.getRole(workspaceId, userId)).thenReturn(Role.MEMBER);

        assertThatThrownBy(() -> presetService.listPresets(workspaceId, userId, "INVALID_SCOPE", null))
                .isInstanceOf(AppException.class)
                .satisfies(ex -> assertThat(((AppException) ex).getErrorCode()).isEqualTo(ErrorCode.PRESET_SCOPE_INVALID));
    }

    @Test
    @DisplayName("listTemplates returns active SYSTEM templates ordered by name")
    void listTemplates_returnsActiveSystemTemplates() {
        MediaPreset t1 = createPreset(UUID.randomUUID(), MediaPresetScope.SYSTEM, null, null, true, false);
        t1.setName("Template Alpha");
        when(mediaPresetRepository.findByScopeAndActiveTrueOrderByNameAsc(MediaPresetScope.SYSTEM))
                .thenReturn(List.of(t1));

        List<MediaPresetResponse> result = presetService.listTemplates();
        assertThat(result).hasSize(1);
        assertThat(result.get(0).name()).isEqualTo("Template Alpha");
    }

    @Test
    @DisplayName("createPreset with scope SYSTEM throws SYSTEM_PRESET_READ_ONLY")
    void createPreset_scopeSystem_throwsReadOnly() {
        CreateMediaPresetRequest req = new CreateMediaPresetRequest(
                "SYSTEM", null, "Sys Preset",
                objectMapper.createObjectNode(), null, null, false
        );

        assertThatThrownBy(() -> presetService.createPreset(workspaceId, userId, req))
                .isInstanceOf(AppException.class)
                .satisfies(ex -> assertThat(((AppException) ex).getErrorCode()).isEqualTo(ErrorCode.SYSTEM_PRESET_READ_ONLY));
    }

    @Test
    @DisplayName("createPreset with scope WORKSPACE verifies LEAD role and unsets old default when isDefault is true")
    void createPreset_scopeWorkspace_unsetsOldDefault() {
        MediaPreset oldDefault = createPreset(UUID.randomUUID(), MediaPresetScope.WORKSPACE, workspaceId, null, true, true);
        when(mediaPresetRepository.findFirstByScopeAndWorkspaceIdAndIsDefaultTrue(MediaPresetScope.WORKSPACE, workspaceId))
                .thenReturn(Optional.of(oldDefault));
        when(mediaPresetRepository.save(any(MediaPreset.class))).thenAnswer(inv -> inv.getArgument(0));

        CreateMediaPresetRequest req = new CreateMediaPresetRequest(
                "WORKSPACE", null, "New Default Preset",
                objectMapper.createObjectNode(), null, null, true
        );

        MediaPresetResponse res = presetService.createPreset(workspaceId, userId, req);

        verify(workspaceAccessService).requireWorkspaceLead(workspaceId, userId);
        assertThat(oldDefault.isDefault()).isFalse();
        verify(mediaPresetRepository).save(oldDefault);
        assertThat(res.isDefault()).isTrue();
        assertThat(res.name()).isEqualTo("New Default Preset");
    }

    @Test
    @DisplayName("createPreset with scope PROJECT without projectId throws PRESET_SCOPE_INVALID")
    void createPreset_scopeProject_nullProjectId_throwsInvalid() {
        CreateMediaPresetRequest req = new CreateMediaPresetRequest(
                "PROJECT", null, "Project Preset",
                objectMapper.createObjectNode(), null, null, false
        );

        assertThatThrownBy(() -> presetService.createPreset(workspaceId, userId, req))
                .isInstanceOf(AppException.class)
                .satisfies(ex -> assertThat(((AppException) ex).getErrorCode()).isEqualTo(ErrorCode.PRESET_SCOPE_INVALID));
    }

    @Test
    @DisplayName("updatePreset on SYSTEM scope throws SYSTEM_PRESET_READ_ONLY")
    void updatePreset_systemPreset_throwsReadOnly() {
        MediaPreset sysPreset = createPreset(presetId, MediaPresetScope.SYSTEM, null, null, true, true);
        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.of(sysPreset));

        UpdateMediaPresetRequest req = new UpdateMediaPresetRequest("New Name", null, null, null, null, null);

        assertThatThrownBy(() -> presetService.updatePreset(workspaceId, userId, presetId, req))
                .isInstanceOf(AppException.class)
                .satisfies(ex -> assertThat(((AppException) ex).getErrorCode()).isEqualTo(ErrorCode.SYSTEM_PRESET_READ_ONLY));
    }

    @Test
    @DisplayName("deletePreset for default preset without replacement throws CANNOT_DELETE_ONLY_DEFAULT_PRESET")
    void deletePreset_defaultWithoutReplacement_throwsError() {
        MediaPreset defaultPreset = createPreset(presetId, MediaPresetScope.WORKSPACE, workspaceId, null, true, true);
        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.of(defaultPreset));

        assertThatThrownBy(() -> presetService.deletePreset(workspaceId, userId, presetId, null))
                .isInstanceOf(AppException.class)
                .satisfies(ex -> assertThat(((AppException) ex).getErrorCode()).isEqualTo(ErrorCode.CANNOT_DELETE_ONLY_DEFAULT_PRESET));
    }

    @Test
    @DisplayName("deletePreset for default preset with valid replacement updates replacement and deletes target")
    void deletePreset_defaultWithValidReplacement_succeeds() {
        UUID replacementId = UUID.randomUUID();
        MediaPreset defaultPreset = createPreset(presetId, MediaPresetScope.WORKSPACE, workspaceId, null, true, true);
        MediaPreset replacement = createPreset(replacementId, MediaPresetScope.WORKSPACE, workspaceId, null, true, false);

        when(mediaPresetRepository.findById(presetId)).thenReturn(Optional.of(defaultPreset));
        when(mediaPresetRepository.findById(replacementId)).thenReturn(Optional.of(replacement));

        presetService.deletePreset(workspaceId, userId, presetId, replacementId);

        assertThat(replacement.isDefault()).isTrue();
        verify(mediaPresetRepository).save(replacement);
        verify(mediaPresetRepository).delete(defaultPreset);
    }
}
