package com.app.modules.media_job.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.media_job.dto.BatchEditSegmentsRequest;
import com.app.modules.media_job.dto.BulkDownloadRequest;
import com.app.modules.media_job.dto.BulkDownloadResponse;
import com.app.modules.media_job.dto.CreateMediaJobRequest;
import com.app.modules.media_job.dto.MediaExportResponse;
import com.app.modules.media_job.dto.MediaJobResponse;
import com.app.modules.media_job.dto.MediaJobStageResponse;
import com.app.modules.media_job.dto.OverrideSourceLangRequest;
import com.app.modules.media_job.dto.PatchSubtitleRequest;
import com.app.modules.media_job.dto.SubtitleSegmentResponse;
import com.app.modules.media_job.dto.render.RenderConfigResponse;
import com.app.modules.media_job.dto.render.UpdateRenderConfigRequest;
import com.app.modules.media_job.dto.VoiceRequest;
import com.app.modules.media_job.entity.Checkpoint;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.service.MediaBulkDownloadService;
import com.app.modules.media_job.service.MediaExportService;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.media_job.service.MediaRenderConfigService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Media Job orchestrator — Localization + Summarization (API_Contract.md §5).
 * Proposal/refine/summary-languages endpoints (§5.1) belong to the summarization module.
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}")
public class MediaJobController {

    private final MediaJobService jobService;
    private final MediaExportService exportService;
    private final MediaRenderConfigService renderConfigService;
    private final MediaBulkDownloadService bulkDownloadService;

    public MediaJobController(MediaJobService jobService, MediaExportService exportService,
                              MediaRenderConfigService renderConfigService,
                              MediaBulkDownloadService bulkDownloadService) {
        this.bulkDownloadService = bulkDownloadService;
        this.jobService = jobService;
        this.exportService = exportService;
        this.renderConfigService = renderConfigService;
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
        List<MediaJob> found = jobService.listJobs(workspaceId, user.id(), projectId, status, recipeId);
        // The list's "current stage" column needs each job's stages; load them in one query.
        Map<UUID, List<MediaJobStage>> stagesByJob = jobService.getStagesByJobIds(
                found.stream().map(MediaJob::getId).toList());
        List<MediaJobResponse> jobs = found.stream()
                .map(job -> MediaJobResponse.from(job, stagesByJob.getOrDefault(job.getId(), List.of()).stream()
                        .map(MediaJobStageResponse::from)
                        .toList()))
                .toList();
        return ApiResponse.<List<MediaJobResponse>>builder().data(jobs).build();
    }

    @PostMapping("/projects/{projectId}/media/jobs/download")
    public ApiResponse<BulkDownloadResponse> bulkDownload(@AuthenticationPrincipal AuthenticatedUser user,
                                                            @PathVariable UUID workspaceId,
                                                            @PathVariable UUID projectId,
                                                            @Valid @RequestBody BulkDownloadRequest request) {
        return ApiResponse.<BulkDownloadResponse>builder()
                .data(bulkDownloadService.download(workspaceId, user.id(), projectId, request.jobIds())).build();
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
        return ApiResponse.<MediaJobResponse>builder().data(toResponse(job)).build();
    }

    @PostMapping("/media/jobs/{jobId}/voice")
    public ApiResponse<MediaJobResponse> setVoice(@AuthenticationPrincipal AuthenticatedUser user,
                                                   @PathVariable UUID workspaceId,
                                                   @PathVariable UUID jobId,
                                                   @RequestBody VoiceRequest request) {
        MediaJob job = jobService.setVoice(workspaceId, user.id(), jobId, request);
        return ApiResponse.<MediaJobResponse>builder().data(toResponse(job)).build();
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

    @PostMapping("/media/jobs/{jobId}/override-source-lang")
    public ApiResponse<MediaJobResponse> overrideSourceLang(@AuthenticationPrincipal AuthenticatedUser user,
                                                              @PathVariable UUID workspaceId,
                                                              @PathVariable UUID jobId,
                                                              @Valid @RequestBody OverrideSourceLangRequest request) {
        MediaJob job = jobService.overrideSourceLang(workspaceId, user.id(), jobId, request.sourceLang());
        return ApiResponse.<MediaJobResponse>builder().data(toResponse(job)).build();
    }

    @PutMapping("/media/jobs/{jobId}/segments/batch")
    public ApiResponse<List<SubtitleSegmentResponse>> batchUpdateSubtitles(@AuthenticationPrincipal AuthenticatedUser user,
                                                                             @PathVariable UUID workspaceId,
                                                                             @PathVariable UUID jobId,
                                                                             @Valid @RequestBody BatchEditSegmentsRequest request) {
        List<SubtitleSegmentResponse> segments = jobService.batchUpdateSubtitles(workspaceId, user.id(), jobId, request)
                .stream().map(SubtitleSegmentResponse::from).toList();
        return ApiResponse.<List<SubtitleSegmentResponse>>builder().data(segments).build();
    }

    @GetMapping("/media/jobs/{jobId}/render-config")
    public ApiResponse<RenderConfigResponse> getRenderConfig(@AuthenticationPrincipal AuthenticatedUser user,
                                                               @PathVariable UUID workspaceId,
                                                               @PathVariable UUID jobId) {
        return ApiResponse.<RenderConfigResponse>builder()
                .data(renderConfigService.get(workspaceId, user.id(), jobId)).build();
    }

    @PutMapping("/media/jobs/{jobId}/render-config")
    public ApiResponse<RenderConfigResponse> updateRenderConfig(@AuthenticationPrincipal AuthenticatedUser user,
                                                                  @PathVariable UUID workspaceId,
                                                                  @PathVariable UUID jobId,
                                                                  @Valid @RequestBody UpdateRenderConfigRequest request) {
        return ApiResponse.<RenderConfigResponse>builder()
                .data(renderConfigService.update(workspaceId, user.id(), jobId, request)).build();
    }

    @PostMapping("/media/jobs/{jobId}/rerun-render")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<MediaJobResponse> rerunRender(@AuthenticationPrincipal AuthenticatedUser user,
                                                       @PathVariable UUID workspaceId,
                                                       @PathVariable UUID jobId,
                                                       @Valid @RequestBody(required = false) UpdateRenderConfigRequest request) {
        MediaJob job = renderConfigService.rerunRender(workspaceId, user.id(), jobId, request);
        return ApiResponse.<MediaJobResponse>builder().data(toResponse(job)).build();
    }

    @GetMapping("/media/jobs/{jobId}/export")
    public ApiResponse<MediaExportResponse> exportJob(@AuthenticationPrincipal AuthenticatedUser user,
                                                       @PathVariable UUID workspaceId,
                                                       @PathVariable UUID jobId,
                                                       @RequestParam(defaultValue = "VIDEO") String format) {
        return ApiResponse.<MediaExportResponse>builder()
                .data(exportService.export(workspaceId, user.id(), jobId, format)).build();
    }

    private MediaJobResponse toResponse(MediaJob job) {
        List<MediaJobStageResponse> stages = jobService.getStages(job.getId()).stream()
                .map(MediaJobStageResponse::from)
                .toList();
        return MediaJobResponse.from(job, stages);
    }
}
