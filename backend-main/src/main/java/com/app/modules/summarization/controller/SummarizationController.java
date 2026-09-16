package com.app.modules.summarization.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.media_job.dto.MediaJobResponse;
import com.app.modules.media_job.dto.MediaJobStageResponse;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.summarization.dto.CustomProposalRequest;
import com.app.modules.summarization.dto.RefineRequest;
import com.app.modules.summarization.dto.SummaryLanguageRequest;
import com.app.modules.summarization.dto.SummaryProposalResponse;
import com.app.modules.summarization.dto.SummaryProposalSegmentResponse;
import com.app.modules.summarization.entity.SummaryProposal;
import com.app.modules.summarization.service.SummarizationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Summarization proposal & refine (API_Contract.md §5.1). "Generate the first AI proposal" has no
 * dedicated endpoint — it happens automatically when the SUMMARIZE stage runs (not built in this
 * iteration; see Backend_Java_TaskSplit_MemberB.md §7.3).
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/media/jobs/{jobId}")
public class SummarizationController {

    private final SummarizationService summarizationService;
    private final MediaJobService mediaJobService;

    public SummarizationController(SummarizationService summarizationService, MediaJobService mediaJobService) {
        this.summarizationService = summarizationService;
        this.mediaJobService = mediaJobService;
    }

    @GetMapping("/proposals")
    public ApiResponse<List<SummaryProposalResponse>> listProposals(@AuthenticationPrincipal AuthenticatedUser user,
                                                                       @PathVariable UUID workspaceId,
                                                                       @PathVariable UUID jobId) {
        List<SummaryProposalResponse> proposals = summarizationService.listActiveProposals(workspaceId, user.id(), jobId)
                .stream().map(this::toResponse).toList();
        return ApiResponse.<List<SummaryProposalResponse>>builder().data(proposals).build();
    }

    @PostMapping("/proposals/custom")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<SummaryProposalResponse> createCustomProposal(@AuthenticationPrincipal AuthenticatedUser user,
                                                                       @PathVariable UUID workspaceId,
                                                                       @PathVariable UUID jobId,
                                                                       @Valid @RequestBody CustomProposalRequest request) {
        SummaryProposal proposal = summarizationService.createCustomProposal(
                workspaceId, user.id(), jobId, request.segments(), request.reasoningNote());
        return ApiResponse.<SummaryProposalResponse>builder().data(toResponse(proposal)).build();
    }

    @PutMapping("/proposals/{proposalId}")
    public ApiResponse<SummaryProposalResponse> updateCustomProposal(@AuthenticationPrincipal AuthenticatedUser user,
                                                                       @PathVariable UUID workspaceId,
                                                                       @PathVariable UUID jobId,
                                                                       @PathVariable UUID proposalId,
                                                                       @Valid @RequestBody CustomProposalRequest request) {
        SummaryProposal proposal = summarizationService.updateCustomProposal(
                workspaceId, user.id(), jobId, proposalId, request.segments(), request.reasoningNote());
        return ApiResponse.<SummaryProposalResponse>builder().data(toResponse(proposal)).build();
    }

    @PostMapping("/proposals/{proposalId}/select")
    public ApiResponse<Void> selectProposal(@AuthenticationPrincipal AuthenticatedUser user,
                                             @PathVariable UUID workspaceId,
                                             @PathVariable UUID jobId,
                                             @PathVariable UUID proposalId) {
        summarizationService.selectProposal(workspaceId, user.id(), jobId, proposalId);
        return ApiResponse.<Void>builder().build();
    }

    @PostMapping("/refine")
    public ApiResponse<SummaryProposalResponse> refine(@AuthenticationPrincipal AuthenticatedUser user,
                                                          @PathVariable UUID workspaceId,
                                                          @PathVariable UUID jobId,
                                                          @Valid @RequestBody RefineRequest request) {
        SummaryProposal proposal = summarizationService.refine(workspaceId, user.id(), jobId, request.feedbackText());
        return ApiResponse.<SummaryProposalResponse>builder().data(toResponse(proposal)).build();
    }

    @PostMapping("/summary-languages")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<MediaJobResponse> createSummaryLanguage(@AuthenticationPrincipal AuthenticatedUser user,
                                                                 @PathVariable UUID workspaceId,
                                                                 @PathVariable UUID jobId,
                                                                 @Valid @RequestBody SummaryLanguageRequest request) {
        MediaJob job = summarizationService.createSummaryLanguageJob(workspaceId, user.id(), jobId, request.targetLang(), request.ttsVoiceId());
        List<MediaJobStageResponse> stages = mediaJobService.getStages(job.getId()).stream()
                .map(MediaJobStageResponse::from)
                .toList();
        return ApiResponse.<MediaJobResponse>builder().data(MediaJobResponse.from(job, stages)).build();
    }

    private SummaryProposalResponse toResponse(SummaryProposal proposal) {
        List<SummaryProposalSegmentResponse> segments = summarizationService.getSegments(proposal.getId()).stream()
                .map(SummaryProposalSegmentResponse::from)
                .toList();
        return SummaryProposalResponse.from(proposal, segments);
    }
}
