package com.app.modules.preset.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.preset.dto.CreateMediaPresetRequest;
import com.app.modules.preset.dto.MediaPresetResponse;
import com.app.modules.preset.dto.UpdateMediaPresetRequest;
import com.app.modules.preset.service.PresetService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Controller for managing workspace and project media presets (API_Contract.md §9).
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/presets")
public class PresetController {

    private final PresetService presetService;

    public PresetController(PresetService presetService) {
        this.presetService = presetService;
    }

    @GetMapping
    public ApiResponse<List<MediaPresetResponse>> listPresets(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId,
            @RequestParam(required = false) String scope,
            @RequestParam(required = false) UUID projectId
    ) {
        return ApiResponse.<List<MediaPresetResponse>>builder()
                .data(presetService.listPresets(workspaceId, user.id(), scope, projectId))
                .build();
    }

    @GetMapping("/{presetId}")
    public ApiResponse<MediaPresetResponse> getPreset(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId,
            @PathVariable UUID presetId
    ) {
        return ApiResponse.<MediaPresetResponse>builder()
                .data(presetService.getPreset(workspaceId, user.id(), presetId))
                .build();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<MediaPresetResponse> createPreset(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId,
            @Valid @RequestBody CreateMediaPresetRequest request
    ) {
        return ApiResponse.<MediaPresetResponse>builder()
                .data(presetService.createPreset(workspaceId, user.id(), request))
                .build();
    }

    @PutMapping("/{presetId}")
    public ApiResponse<MediaPresetResponse> updatePreset(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId,
            @PathVariable UUID presetId,
            @Valid @RequestBody UpdateMediaPresetRequest request
    ) {
        return ApiResponse.<MediaPresetResponse>builder()
                .data(presetService.updatePreset(workspaceId, user.id(), presetId, request))
                .build();
    }

    @DeleteMapping("/{presetId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deletePreset(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID workspaceId,
            @PathVariable UUID presetId,
            @RequestParam(required = false) UUID replacementPresetId
    ) {
        presetService.deletePreset(workspaceId, user.id(), presetId, replacementPresetId);
    }
}
