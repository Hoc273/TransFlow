package com.app.modules.transformation.controller;

import com.app.common.dto.ApiResponse;
import com.app.modules.transformation.dto.AvailabilityProjection;
import com.app.modules.transformation.service.TransformationService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/transformation")
public class TransformationController {

    private final TransformationService transformationService;

    public TransformationController(TransformationService transformationService) {
        this.transformationService = transformationService;
    }

    @GetMapping("/capabilities")
    public ApiResponse<AvailabilityProjection> getCapabilities() {
        return ApiResponse.<AvailabilityProjection>builder()
                .data(transformationService.getCapabilities())
                .build();
    }
}
