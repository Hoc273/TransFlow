package com.app.modules.provider.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.provider.dto.*;
import com.app.modules.provider.service.TtsVoiceService;
import com.app.modules.provider.service.UserAiProviderService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Controller for managing personal AI providers (BYOK) and their cached TTS voices (API_Contract.md §11).
 */
@RestController
@RequestMapping("/api/users/me/providers")
public class UserAiProviderController {

    private final UserAiProviderService providerService;
    private final TtsVoiceService ttsVoiceService;

    public UserAiProviderController(UserAiProviderService providerService,
                                    TtsVoiceService ttsVoiceService) {
        this.providerService = providerService;
        this.ttsVoiceService = ttsVoiceService;
    }

    @GetMapping
    public ApiResponse<List<UserAiProviderResponse>> listProviders(@AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<List<UserAiProviderResponse>>builder()
                .data(providerService.listProviders(user.id()))
                .build();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<UserAiProviderResponse> createProvider(@AuthenticationPrincipal AuthenticatedUser user,
                                                              @Valid @RequestBody CreateUserAiProviderRequest request) {
        return ApiResponse.<UserAiProviderResponse>builder()
                .data(providerService.createProvider(user.id(), request))
                .build();
    }

    @GetMapping("/{id}")
    public ApiResponse<UserAiProviderResponse> getProvider(@AuthenticationPrincipal AuthenticatedUser user,
                                                           @PathVariable UUID id) {
        return ApiResponse.<UserAiProviderResponse>builder()
                .data(providerService.getProvider(user.id(), id))
                .build();
    }

    @PutMapping("/{id}")
    public ApiResponse<UserAiProviderResponse> updateProvider(@AuthenticationPrincipal AuthenticatedUser user,
                                                              @PathVariable UUID id,
                                                              @Valid @RequestBody UpdateUserAiProviderRequest request) {
        return ApiResponse.<UserAiProviderResponse>builder()
                .data(providerService.updateProvider(user.id(), id, request))
                .build();
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteProvider(@AuthenticationPrincipal AuthenticatedUser user,
                                            @PathVariable UUID id) {
        providerService.deleteProvider(user.id(), id);
        return ApiResponse.<Void>builder().build();
    }

    @PostMapping("/{id}/test")
    public ApiResponse<TestConnectionResponse> testProvider(@AuthenticationPrincipal AuthenticatedUser user,
                                                            @PathVariable UUID id) {
        return ApiResponse.<TestConnectionResponse>builder()
                .data(providerService.testProvider(user.id(), id))
                .build();
    }

    @GetMapping("/{id}/voices")
    public ApiResponse<List<TtsVoiceResponse>> listVoices(@AuthenticationPrincipal AuthenticatedUser user,
                                                          @PathVariable UUID id,
                                                          @RequestParam(required = false) String language) {
        return ApiResponse.<List<TtsVoiceResponse>>builder()
                .data(ttsVoiceService.listUserVoices(user.id(), id, language))
                .build();
    }

    @PostMapping("/{id}/voices/refresh")
    public ApiResponse<List<TtsVoiceResponse>> refreshVoices(@AuthenticationPrincipal AuthenticatedUser user,
                                                             @PathVariable UUID id) {
        return ApiResponse.<List<TtsVoiceResponse>>builder()
                .data(ttsVoiceService.refreshUserVoices(user.id(), id))
                .build();
    }
}
