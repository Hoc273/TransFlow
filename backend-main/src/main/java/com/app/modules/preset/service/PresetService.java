package com.app.modules.preset.service;

import com.app.modules.preset.dto.CreateMediaPresetRequest;
import com.app.modules.preset.dto.MediaPresetResponse;
import com.app.modules.preset.dto.UpdateMediaPresetRequest;

import java.util.List;
import java.util.UUID;

public interface PresetService {

    List<MediaPresetResponse> listPresets(UUID workspaceId, UUID userId, String scope, UUID projectId);

    MediaPresetResponse getPreset(UUID workspaceId, UUID userId, UUID presetId);

    List<MediaPresetResponse> listTemplates();

    MediaPresetResponse createPreset(UUID workspaceId, UUID userId, CreateMediaPresetRequest request);

    MediaPresetResponse updatePreset(UUID workspaceId, UUID userId, UUID presetId, UpdateMediaPresetRequest request);

    void deletePreset(UUID workspaceId, UUID userId, UUID presetId, UUID replacementPresetId);
}
