package com.app.modules.media_job.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.media_job.dto.pkg.OutputPackageResponse;
import com.app.modules.media_job.dto.pkg.PublishPackageResponse;
import com.app.modules.media_job.dto.pkg.UpdatePublishPackageRequest;
import com.app.modules.media_job.service.MediaPackageService;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** Output package + publish-package draft of a media job (API_Contract.md §5). */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/media/jobs/{jobId}")
public class MediaPackageController {

    private final MediaPackageService service;

    public MediaPackageController(MediaPackageService service) {
        this.service = service;
    }

    @GetMapping("/output-package")
    public ApiResponse<OutputPackageResponse> outputPackage(@AuthenticationPrincipal AuthenticatedUser user,
                                                             @PathVariable UUID workspaceId,
                                                             @PathVariable UUID jobId) {
        return ApiResponse.<OutputPackageResponse>builder().data(service.outputPackage(workspaceId, user.id(), jobId)).build();
    }

    @GetMapping("/publish-package")
    public ApiResponse<PublishPackageResponse> getPublishPackage(@AuthenticationPrincipal AuthenticatedUser user,
                                                                  @PathVariable UUID workspaceId,
                                                                  @PathVariable UUID jobId) {
        return ApiResponse.<PublishPackageResponse>builder().data(service.getPublishPackage(workspaceId, user.id(), jobId)).build();
    }

    @PutMapping("/publish-package")
    public ApiResponse<PublishPackageResponse> updatePublishPackage(@AuthenticationPrincipal AuthenticatedUser user,
                                                                     @PathVariable UUID workspaceId,
                                                                     @PathVariable UUID jobId,
                                                                     @Valid @RequestBody UpdatePublishPackageRequest request) {
        return ApiResponse.<PublishPackageResponse>builder()
                .data(service.updatePublishPackage(workspaceId, user.id(), jobId, request)).build();
    }
}
