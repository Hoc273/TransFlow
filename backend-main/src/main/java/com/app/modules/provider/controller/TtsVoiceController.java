package com.app.modules.provider.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.provider.dto.TtsVoicePreviewRequest;
import com.app.modules.provider.dto.TtsVoicePreviewResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;
import com.app.modules.provider.service.TtsVoiceService;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Controller for listing platform TTS voices (API_Contract.md §11).
 */
@RestController
@RequestMapping("/api/tts-voices")
public class TtsVoiceController {

    private final TtsVoiceService ttsVoiceService;

    public TtsVoiceController(TtsVoiceService ttsVoiceService) {
        this.ttsVoiceService = ttsVoiceService;
    }

    @GetMapping
    public ApiResponse<List<TtsVoiceResponse>> listVoices(
            @RequestParam(required = false) String language,
            @RequestParam(defaultValue = "PLATFORM") String providerSource) {
        return ApiResponse.<List<TtsVoiceResponse>>builder()
                .data(ttsVoiceService.listPlatformVoices(language, providerSource))
                .build();
    }

    @PostMapping("/preview")
    public ApiResponse<TtsVoicePreviewResponse> previewVoice(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody TtsVoicePreviewRequest request) {
        return ApiResponse.<TtsVoicePreviewResponse>builder()
                .data(ttsVoiceService.previewVoice(user.id(), request))
                .build();
    }
}
