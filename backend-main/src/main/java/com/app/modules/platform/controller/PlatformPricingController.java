package com.app.modules.platform.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.credit.dto.CreatePricingVersionRequest;
import com.app.modules.credit.dto.CreatePricingVersionResponse;
import com.app.modules.credit.dto.PricingCoverageItem;
import com.app.modules.credit.dto.PricingPreviewRequest;
import com.app.modules.credit.dto.PricingPreviewResponse;
import com.app.modules.credit.dto.PricingVersionResponse;
import com.app.modules.platform.service.PlatformPricingService;
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
 * Credit price table x, y (Credit_Coefficient_Calculation §10.2). Versioned: there is no
 * update or delete — a change is a new version that closes the previous one.
 */
@RestController
@RequestMapping("/api/platform/pricing")
public class PlatformPricingController {

    private final PlatformPricingService service;

    public PlatformPricingController(PlatformPricingService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<PricingVersionResponse>> list(@AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<List<PricingVersionResponse>>builder().data(service.listCurrent(user.id())).build();
    }

    /** {@code providerScope}: omitted = all scopes, {@code default} = the NULL-scope rows only. */
    @GetMapping("/history")
    public ApiResponse<List<PricingVersionResponse>> history(@AuthenticationPrincipal AuthenticatedUser user,
                                                             @RequestParam(required = false) String capability,
                                                             @RequestParam(required = false) String providerScope) {
        return ApiResponse.<List<PricingVersionResponse>>builder()
                .data(service.history(user.id(), capability, providerScope)).build();
    }

    @PostMapping
    public ApiResponse<CreatePricingVersionResponse> create(@AuthenticationPrincipal AuthenticatedUser user,
                                                            @Valid @RequestBody CreatePricingVersionRequest request) {
        return ApiResponse.<CreatePricingVersionResponse>builder().data(service.create(user.id(), request)).build();
    }

    @PostMapping("/preview")
    public ApiResponse<PricingPreviewResponse> preview(@AuthenticationPrincipal AuthenticatedUser user,
                                                       @Valid @RequestBody PricingPreviewRequest request) {
        return ApiResponse.<PricingPreviewResponse>builder().data(service.preview(user.id(), request)).build();
    }

    @GetMapping("/coverage")
    public ApiResponse<List<PricingCoverageItem>> coverage(@AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<List<PricingCoverageItem>>builder().data(service.coverage(user.id())).build();
    }
}
