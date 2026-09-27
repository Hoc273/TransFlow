package com.app.modules.transformation.controller;

import com.app.common.dto.ApiResponse;
import com.app.modules.transformation.dto.AvailabilityProjection;
import com.app.modules.transformation.service.WorkerCapabilityService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/transformation")
public class TransformationController {

    private final WorkerCapabilityService workerCapabilityService;

    public TransformationController(WorkerCapabilityService workerCapabilityService) {
        this.workerCapabilityService = workerCapabilityService;
    }

    @GetMapping("/capabilities")
    public ApiResponse<AvailabilityProjection> getCapabilities() {
        return ApiResponse.<AvailabilityProjection>builder()
                .data(workerCapabilityService.getCapabilities())
                .build();
    }
}
