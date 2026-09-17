package com.app.modules.batch.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.batch.dto.CreateBatchRequest;
import com.app.modules.batch.dto.LocalizationBatchResponse;
import com.app.modules.batch.entity.LocalizationBatch;
import com.app.modules.batch.service.BatchService;
import com.app.modules.media_job.dto.MediaJobResponse;
import com.app.modules.media_job.dto.MediaJobStageResponse;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.service.MediaJobService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Video Batch Localization (API_Contract.md §6). {@code GET .../download} is not implemented — it needs
 * actual rendered artifacts from a stage executor that doesn't exist yet (see
 * Backend_Java_TaskSplit_MemberB.md §7.4).
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}")
public class BatchController {

    private final BatchService batchService;
    private final MediaJobService mediaJobService;

    public BatchController(BatchService batchService, MediaJobService mediaJobService) {
        this.batchService = batchService;
        this.mediaJobService = mediaJobService;
    }

    @PostMapping("/projects/{projectId}/batches")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<LocalizationBatchResponse> createBatch(@AuthenticationPrincipal AuthenticatedUser user,
                                                                 @PathVariable UUID workspaceId,
                                                                 @PathVariable UUID projectId,
                                                                 @Valid @RequestBody CreateBatchRequest request) {
        LocalizationBatch batch = batchService.createBatch(workspaceId, user.id(), projectId, request);
        return ApiResponse.<LocalizationBatchResponse>builder().data(toResponse(batch)).build();
    }

    @GetMapping("/projects/{projectId}/batches")
    public ApiResponse<List<LocalizationBatchResponse>> listBatches(@AuthenticationPrincipal AuthenticatedUser user,
                                                                       @PathVariable UUID workspaceId,
                                                                       @PathVariable UUID projectId) {
        List<LocalizationBatchResponse> batches = batchService.listBatches(workspaceId, user.id(), projectId).stream()
                .map(b -> LocalizationBatchResponse.from(b, null))
                .toList();
        return ApiResponse.<List<LocalizationBatchResponse>>builder().data(batches).build();
    }

    @GetMapping("/batches/{batchId}")
    public ApiResponse<LocalizationBatchResponse> getBatch(@AuthenticationPrincipal AuthenticatedUser user,
                                                              @PathVariable UUID workspaceId,
                                                              @PathVariable UUID batchId) {
        LocalizationBatch batch = batchService.getBatch(workspaceId, user.id(), batchId);
        return ApiResponse.<LocalizationBatchResponse>builder().data(toResponse(batch)).build();
    }

    @PostMapping("/batches/{batchId}/cancel")
    public ApiResponse<LocalizationBatchResponse> cancelBatch(@AuthenticationPrincipal AuthenticatedUser user,
                                                                 @PathVariable UUID workspaceId,
                                                                 @PathVariable UUID batchId) {
        LocalizationBatch batch = batchService.cancelBatch(workspaceId, user.id(), batchId);
        return ApiResponse.<LocalizationBatchResponse>builder().data(toResponse(batch)).build();
    }

    @PostMapping("/batches/{batchId}/jobs/{jobId}/retry")
    public ApiResponse<MediaJobResponse> retryChildJob(@AuthenticationPrincipal AuthenticatedUser user,
                                                         @PathVariable UUID workspaceId,
                                                         @PathVariable UUID batchId,
                                                         @PathVariable UUID jobId) {
        MediaJob job = batchService.retryChildJob(workspaceId, user.id(), batchId, jobId);
        List<MediaJobStageResponse> stages = mediaJobService.getStages(job.getId()).stream()
                .map(MediaJobStageResponse::from)
                .toList();
        return ApiResponse.<MediaJobResponse>builder().data(MediaJobResponse.from(job, stages)).build();
    }

    private LocalizationBatchResponse toResponse(LocalizationBatch batch) {
        List<MediaJobResponse> jobs = batchService.getChildJobs(batch.getId()).stream()
                .map(MediaJobResponse::from)
                .toList();
        return LocalizationBatchResponse.from(batch, jobs);
    }
}
