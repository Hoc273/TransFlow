package com.app.modules.provider.controller;

import com.app.common.dto.ApiResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;
import com.app.modules.provider.service.TtsVoiceService;
import org.springframework.web.bind.annotation.GetMapping;
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
}
