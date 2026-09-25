package com.app.modules.platform.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.platform.service.PlatformProviderAdminService;
import com.app.modules.provider.dto.CreatePlatformAiProviderRequest;
import com.app.modules.provider.dto.PlatformAiProviderResponse;
import com.app.modules.provider.dto.TestConnectionResponse;
import com.app.modules.provider.dto.UpdatePlatformAiProviderRequest;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Shared platform AI key pool (API_Contract.md §13.1). Users without a personal key for a
 * capability are served from this pool and billed in credits. API keys are write-only.
 */
@RestController
@RequestMapping("/api/platform/providers")
public class PlatformProviderController {

    private final PlatformProviderAdminService service;

    public PlatformProviderController(PlatformProviderAdminService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<PlatformAiProviderResponse>> list(@AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<List<PlatformAiProviderResponse>>builder().data(service.list(user.id())).build();
    }

    @PostMapping
    public ApiResponse<PlatformAiProviderResponse> create(@AuthenticationPrincipal AuthenticatedUser user,
                                                          @Valid @RequestBody CreatePlatformAiProviderRequest request) {
        return ApiResponse.<PlatformAiProviderResponse>builder().data(service.create(user.id(), request)).build();
    }

    @PatchMapping("/{providerId}")
    public ApiResponse<PlatformAiProviderResponse> update(@AuthenticationPrincipal AuthenticatedUser user,
                                                          @PathVariable UUID providerId,
                                                          @Valid @RequestBody UpdatePlatformAiProviderRequest request) {
        return ApiResponse.<PlatformAiProviderResponse>builder()
                .data(service.update(user.id(), providerId, request)).build();
    }

    @DeleteMapping("/{providerId}")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID providerId) {
        service.delete(user.id(), providerId);
        return ApiResponse.<Void>builder().build();
    }

    @PostMapping("/{providerId}/test")
    public ApiResponse<TestConnectionResponse> test(@AuthenticationPrincipal AuthenticatedUser user,
                                                    @PathVariable UUID providerId) {
        return ApiResponse.<TestConnectionResponse>builder().data(service.test(user.id(), providerId)).build();
    }

    @PostMapping("/{providerId}/voices/sync")
    public ApiResponse<Map<String, Integer>> syncVoices(@AuthenticationPrincipal AuthenticatedUser user,
                                                        @PathVariable UUID providerId) {
        return ApiResponse.<Map<String, Integer>>builder()
                .data(Map.of("activeVoices", service.syncVoices(user.id(), providerId))).build();
    }
}
