package com.app.modules.media_job.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.media_job.dto.CreateMediaJobRequest;
import com.app.modules.media_job.dto.MediaJobResponse;
import com.app.modules.media_job.dto.MediaJobStageResponse;
import com.app.modules.media_job.dto.PatchSubtitleRequest;
import com.app.modules.media_job.dto.SubtitleSegmentResponse;
import com.app.modules.media_job.dto.VoiceRequest;
import com.app.modules.media_job.entity.Checkpoint;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.service.MediaJobService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Media Job orchestrator — Localization + Summarization (API_Contract.md §5).
 * Proposal/refine/summary-languages endpoints (§5.1) belong to the summarization module;
 * export (§5, last row) needs the qa module's blocking-issue gate — both out of this module's scope.
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}")
public class MediaJobController {

    private final MediaJobService jobService;

    public MediaJobController(MediaJobService jobService) {
        this.jobService = jobService;
    }

    @PostMapping("/media/jobs")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<MediaJobResponse> createJob(@AuthenticationPrincipal AuthenticatedUser user,
                                                     @PathVariable UUID workspaceId,
                                                     @Valid @RequestBody CreateMediaJobRequest request) {
        MediaJob job = jobService.createJob(workspaceId, user.id(), request);
        return ApiResponse.<MediaJobResponse>builder().data(toResponse(job)).build();
    }

    @GetMapping("/projects/{projectId}/media/jobs")
    public ApiResponse<List<MediaJobResponse>> listJobs(@AuthenticationPrincipal AuthenticatedUser user,
                                                          @PathVariable UUID workspaceId,
                                                          @PathVariable UUID projectId,
                                                          @RequestParam(required = false) MediaJob.JobStatus status,
                                                          @RequestParam(required = false) String recipeId) {
        List<MediaJobResponse> jobs = jobService.listJobs(workspaceId, user.id(), projectId, status, recipeId).stream()
                .map(MediaJobResponse::from)
                .toList();
        return ApiResponse.<List<MediaJobResponse>>builder().data(jobs).build();
    }

    @GetMapping("/media/jobs/{jobId}")
    public ApiResponse<MediaJobResponse> getJob(@AuthenticationPrincipal AuthenticatedUser user,
                                                 @PathVariable UUID workspaceId,
                                                 @PathVariable UUID jobId) {
        MediaJob job = jobService.getJob(workspaceId, user.id(), jobId);
        return ApiResponse.<MediaJobResponse>builder().data(toResponse(job)).build();
    }

    @PostMapping("/media/jobs/{jobId}/cancel")
    public ApiResponse<MediaJobResponse> cancelJob(@AuthenticationPrincipal AuthenticatedUser user,
                                                    @PathVariable UUID workspaceId,
                                                    @PathVariable UUID jobId) {
        MediaJob job = jobService.cancelJob(workspaceId, user.id(), jobId);
        return ApiResponse.<MediaJobResponse>builder().data(MediaJobResponse.from(job)).build();
    }

    @PostMapping("/media/jobs/{jobId}/voice")
    public ApiResponse<MediaJobResponse> setVoice(@AuthenticationPrincipal AuthenticatedUser user,
                                                   @PathVariable UUID workspaceId,
                                                   @PathVariable UUID jobId,
                                                   @RequestBody VoiceRequest request) {
        MediaJob job = jobService.setVoice(workspaceId, user.id(), jobId, request.ttsVoiceId());
        return ApiResponse.<MediaJobResponse>builder().data(MediaJobResponse.from(job)).build();
    }

    @PostMapping("/media/jobs/{jobId}/checkpoints/{checkpoint}/confirm")
    public ApiResponse<Void> confirmCheckpoint(@AuthenticationPrincipal AuthenticatedUser user,
                                                @PathVariable UUID workspaceId,
                                                @PathVariable UUID jobId,
                                                @PathVariable Checkpoint checkpoint) {
        jobService.confirmCheckpoint(workspaceId, user.id(), jobId, checkpoint);
        return ApiResponse.<Void>builder().build();
    }

    @PostMapping("/media/jobs/{jobId}/stages/{stageName}/rerun")
    public ApiResponse<MediaJobResponse> rerunFromStage(@AuthenticationPrincipal AuthenticatedUser user,
                                                          @PathVariable UUID workspaceId,
                                                          @PathVariable UUID jobId,
                                                          @PathVariable MediaJobStage.StageName stageName) {
        MediaJob job = jobService.rerunFromStage(workspaceId, user.id(), jobId, stageName);
        return ApiResponse.<MediaJobResponse>builder().data(toResponse(job)).build();
    }

    @GetMapping("/media/jobs/{jobId}/subtitles")
    public ApiResponse<List<SubtitleSegmentResponse>> listSubtitles(@AuthenticationPrincipal AuthenticatedUser user,
                                                                      @PathVariable UUID workspaceId,
                                                                      @PathVariable UUID jobId) {
        List<SubtitleSegmentResponse> segments = jobService.listSubtitles(workspaceId, user.id(), jobId).stream()
                .map(SubtitleSegmentResponse::from)
                .toList();
        return ApiResponse.<List<SubtitleSegmentResponse>>builder().data(segments).build();
    }

    @PatchMapping("/media/jobs/{jobId}/subtitles/{segmentId}")
    public ApiResponse<SubtitleSegmentResponse> patchSubtitle(@AuthenticationPrincipal AuthenticatedUser user,
                                                                @PathVariable UUID workspaceId,
                                                                @PathVariable UUID jobId,
                                                                @PathVariable UUID segmentId,
                                                                @RequestBody PatchSubtitleRequest request) {
        var segment = jobService.patchSubtitle(workspaceId, user.id(), jobId, segmentId, request);
        return ApiResponse.<SubtitleSegmentResponse>builder().data(SubtitleSegmentResponse.from(segment)).build();
    }

    private MediaJobResponse toResponse(MediaJob job) {
        List<MediaJobStageResponse> stages = jobService.getStages(job.getId()).stream()
                .map(MediaJobStageResponse::from)
                .toList();
        return MediaJobResponse.from(job, stages);
    }
}
