package com.app.modules.preset.controller;

import com.app.common.dto.ApiResponse;
import com.app.modules.preset.dto.MediaPresetResponse;
import com.app.modules.preset.service.PresetService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Public template catalog for SYSTEM presets (API_Contract.md §9).
 * Read-only, accessible to all authenticated users without workspace parameter.
 */
@RestController
@RequestMapping("/api/media/presets")
public class PresetTemplateController {

    private final PresetService presetService;

    public PresetTemplateController(PresetService presetService) {
        this.presetService = presetService;
    }

    @GetMapping("/templates")
    public ApiResponse<List<MediaPresetResponse>> listTemplates() {
        return ApiResponse.<List<MediaPresetResponse>>builder()
                .data(presetService.listTemplates())
                .build();
    }
}
