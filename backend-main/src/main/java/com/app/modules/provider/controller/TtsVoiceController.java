package com.app.modules.provider.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.CurrentUser;
import com.app.modules.provider.dto.PlatformTtsProviderResponse;
import com.app.modules.provider.dto.PreviewTtsVoiceRequest;
import com.app.modules.provider.dto.PreviewTtsVoiceResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;
import com.app.modules.provider.service.TtsVoiceService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

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

    /** Platform voices only; {@code providerSource} is accepted for compatibility but BYOK voices are never listed here. */
    @GetMapping
    public ApiResponse<List<TtsVoiceResponse>> listVoices(
            @RequestParam(required = false) String language,
            @RequestParam(required = false) UUID platformProviderId) {
        return ApiResponse.<List<TtsVoiceResponse>>builder()
                .data(ttsVoiceService.listPlatformVoices(language, platformProviderId))
                .build();
    }

    /** Shared platform TTS keys a user without BYOK can pick a voice from. */
    @GetMapping("/providers")
    public ApiResponse<List<PlatformTtsProviderResponse>> listProviders() {
        return ApiResponse.<List<PlatformTtsProviderResponse>>builder()
                .data(ttsVoiceService.listPlatformTtsProviders())
                .build();
    }

    @PostMapping("/preview")
    public ApiResponse<PreviewTtsVoiceResponse> previewVoice(
            @Valid @RequestBody PreviewTtsVoiceRequest request) {
        return ApiResponse.<PreviewTtsVoiceResponse>builder()
                .data(ttsVoiceService.previewVoice(CurrentUser.require().id(), request))
                .build();
    }
}
