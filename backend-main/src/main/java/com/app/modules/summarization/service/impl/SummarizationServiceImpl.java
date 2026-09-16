package com.app.modules.summarization.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.summarization.dto.SegmentRange;
import com.app.modules.summarization.entity.SummaryProposal;
import com.app.modules.summarization.entity.SummaryProposalSegment;
import com.app.modules.summarization.repository.SummaryProposalRepository;
import com.app.modules.summarization.repository.SummaryProposalSegmentRepository;
import com.app.modules.summarization.service.RefineSessionStore;
import com.app.modules.summarization.service.SummaryAiClient;
import com.app.modules.summarization.service.SummarizationService;
import com.app.modules.workspace.service.WorkspaceAccessService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class SummarizationServiceImpl implements SummarizationService {

    // Default assumption (not pinned in SRS/Arch §14) — confirm with BA before relying on this in FE.
    private static final double DURATION_TOLERANCE_RATIO = 0.2;
    private static final int MAX_REFINE_PER_SESSION = 5;

    private final SummaryProposalRepository summaryProposalRepository;
    private final SummaryProposalSegmentRepository summaryProposalSegmentRepository;
    private final WorkspaceAccessService access;
    private final MediaJobService mediaJobService;
    private final SummaryAiClient aiClient;
    private final RefineSessionStore refineSessionStore;
    private final ObjectMapper objectMapper;

    public SummarizationServiceImpl(SummaryProposalRepository summaryProposalRepository,
                                     SummaryProposalSegmentRepository summaryProposalSegmentRepository,
                                     WorkspaceAccessService access,
                                     MediaJobService mediaJobService,
                                     SummaryAiClient aiClient,
                                     RefineSessionStore refineSessionStore,
                                     ObjectMapper objectMapper) {
        this.summaryProposalRepository = summaryProposalRepository;
        this.summaryProposalSegmentRepository = summaryProposalSegmentRepository;
        this.access = access;
        this.mediaJobService = mediaJobService;
        this.aiClient = aiClient;
        this.refineSessionStore = refineSessionStore;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional(readOnly = true)
    public List<SummaryProposal> listActiveProposals(UUID workspaceId, UUID userId, UUID jobId) {
        mediaJobService.getJob(workspaceId, userId, jobId); // enforces project read access
        UUID stageId = findStageId(jobId, MediaJobStage.StageName.SUMMARIZE);
        // refine() archives the previous AI round before inserting the next one, so at most 1 AI row
        // is ever non-archived here — no extra "latest round" filtering needed.
        return summaryProposalRepository.findByMediaJobStageIdAndArchivedAtIsNull(stageId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<SummaryProposalSegment> getSegments(UUID proposalId) {
        return summaryProposalSegmentRepository.findByProposalIdOrderBySeq(proposalId);
    }

    @Override
    @Transactional
    public SummaryProposal createCustomProposal(UUID workspaceId, UUID userId, UUID jobId,
                                                 List<SegmentRange> segments, String reasoningNote) {
        MediaJob job = mediaJobService.getJob(workspaceId, userId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());
        requireValidSegments(segments);

        UUID stageId = findStageId(jobId, MediaJobStage.StageName.SUMMARIZE);
        SummaryProposal proposal = new SummaryProposal();
        proposal.setMediaJobStageId(stageId);
        proposal.setGeneratedBy(SummaryProposal.GeneratedBy.HUMAN);
        proposal.setGenerationRound((short) 1);
        proposal.setReasoningNote(reasoningNote);
        proposal.setCreatedAt(Instant.now());
        proposal = summaryProposalRepository.save(proposal);

        persistSegments(proposal.getId(), segments);
        return proposal;
    }

    @Override
    @Transactional
    public SummaryProposal updateCustomProposal(UUID workspaceId, UUID userId, UUID jobId, UUID proposalId,
                                                 List<SegmentRange> segments, String reasoningNote) {
        MediaJob job = mediaJobService.getJob(workspaceId, userId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());
        requireValidSegments(segments);

        UUID stageId = findStageId(jobId, MediaJobStage.StageName.SUMMARIZE);
        SummaryProposal proposal = summaryProposalRepository.findByIdAndMediaJobStageId(proposalId, stageId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        if (proposal.getGeneratedBy() != SummaryProposal.GeneratedBy.HUMAN) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        proposal.setReasoningNote(reasoningNote);
        proposal = summaryProposalRepository.save(proposal);
        summaryProposalSegmentRepository.deleteByProposalId(proposal.getId());
        persistSegments(proposal.getId(), segments);
        return proposal;
    }

    @Override
    @Transactional
    public void selectProposal(UUID workspaceId, UUID userId, UUID jobId, UUID proposalId) {
        MediaJob job = mediaJobService.getJob(workspaceId, userId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());

        UUID stageId = findStageId(jobId, MediaJobStage.StageName.SUMMARIZE);
        SummaryProposal proposal = summaryProposalRepository.findByIdAndMediaJobStageId(proposalId, stageId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        if (proposal.getArchivedAt() != null) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        mediaJobService.updateSelectedProposal(workspaceId, userId, jobId, proposalId);
    }

    @Override
    @Transactional
    public SummaryProposal refine(UUID workspaceId, UUID userId, UUID jobId, String feedbackText) {
        MediaJob job = mediaJobService.getJob(workspaceId, userId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());
        if (!MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(job.getRecipeId()) || job.getRequestedDurationSeconds() == null) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        UUID stageId = findStageId(jobId, MediaJobStage.StageName.SUMMARIZE);
        SummaryProposal current = summaryProposalRepository
                .findTopByMediaJobStageIdAndGeneratedByOrderByGenerationRoundDesc(stageId, SummaryProposal.GeneratedBy.AI)
                .filter(p -> p.getArchivedAt() == null)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));

        boolean alreadyTranslated = current.getId().equals(job.getSelectedProposalId()) && isStageCompleted(jobId, MediaJobStage.StageName.TRANSLATE);
        if (alreadyTranslated) {
            throw new AppException(ErrorCode.PROPOSAL_ALREADY_TRANSLATED);
        }

        if (refineSessionStore.incrementAndGet(jobId) > MAX_REFINE_PER_SESSION) {
            throw new AppException(ErrorCode.REFINE_LIMIT_REACHED);
        }

        SummaryAiClient.ScriptProposalResult result = aiClient.refineScript(
                current.getScriptContent(), feedbackText, job.getTargetLang());

        current.setArchivedAt(Instant.now());
        summaryProposalRepository.save(current);

        short nextRound = (short) (current.getGenerationRound() + 1);
        return persistAiProposal(stageId, nextRound, result, feedbackText, job.getRequestedDurationSeconds());
    }

    @Override
    @Transactional
    public SummaryProposal generateAiProposal(UUID mediaJobStageId, String transcript, String visualContext,
                                               int requestedDurationSeconds, String targetLang) {
        SummaryAiClient.ScriptProposalResult result = aiClient.generateScript(transcript, visualContext, requestedDurationSeconds, targetLang);
        return persistAiProposal(mediaJobStageId, (short) 1, result, null, requestedDurationSeconds);
    }

    @Override
    @Transactional
    public MediaJob createSummaryLanguageJob(UUID workspaceId, UUID userId, UUID jobId, String targetLang, UUID ttsVoiceId) {
        MediaJob source = mediaJobService.getJob(workspaceId, userId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, source.getProjectId());

        if (!MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(source.getRecipeId()) || source.getSelectedProposalId() == null) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        SummaryProposal proposal = summaryProposalRepository.findById(source.getSelectedProposalId())
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        if (proposal.getGeneratedBy() != SummaryProposal.GeneratedBy.AI) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        return mediaJobService.createDerivedSummaryJob(workspaceId, userId, jobId, targetLang, ttsVoiceId);
    }

    // ---- helpers ----

    private UUID findStageId(UUID jobId, MediaJobStage.StageName name) {
        return mediaJobService.getStages(jobId).stream()
                .filter(s -> s.getStageName() == name)
                .map(MediaJobStage::getId)
                .findFirst()
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
    }

    private boolean isStageCompleted(UUID jobId, MediaJobStage.StageName name) {
        return mediaJobService.getStages(jobId).stream()
                .filter(s -> s.getStageName() == name)
                .anyMatch(s -> s.getStatus() == MediaJobStage.StageStatus.COMPLETED);
    }

    private void requireValidSegments(List<SegmentRange> segments) {
        if (segments == null || segments.isEmpty()) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        for (SegmentRange s : segments) {
            if (s.endMs() <= s.startMs()) {
                throw new AppException(ErrorCode.VALIDATION_ERROR);
            }
        }
    }

    private void persistSegments(UUID proposalId, List<SegmentRange> segments) {
        int seq = 1;
        for (SegmentRange range : segments) {
            SummaryProposalSegment segment = new SummaryProposalSegment();
            segment.setProposalId(proposalId);
            segment.setSeq(seq++);
            segment.setStartMs(range.startMs());
            segment.setEndMs(range.endMs());
            segment.setCreatedAt(Instant.now());
            summaryProposalSegmentRepository.save(segment);
        }
    }

    // Arch §7.2 — validate script not empty, each segment matches part of the script, total duration in tolerance.
    private SummaryProposal persistAiProposal(UUID stageId, short round, SummaryAiClient.ScriptProposalResult result,
                                               String feedbackText, int requestedDurationSeconds) {
        if (result.scriptContent() == null || result.scriptContent().isBlank()
                || result.segments() == null || result.segments().isEmpty()) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        long totalMs = 0;
        for (SummaryAiClient.SegmentDraft seg : result.segments()) {
            if (seg.endMs() <= seg.startMs()) {
                throw new AppException(ErrorCode.VALIDATION_ERROR);
            }
            if (seg.scriptExcerpt() != null && !seg.scriptExcerpt().isBlank()
                    && !result.scriptContent().contains(seg.scriptExcerpt().trim())) {
                throw new AppException(ErrorCode.VALIDATION_ERROR);
            }
            totalMs += seg.endMs() - seg.startMs();
        }
        long requestedMs = requestedDurationSeconds * 1000L;
        long lower = (long) (requestedMs * (1 - DURATION_TOLERANCE_RATIO));
        long upper = (long) (requestedMs * (1 + DURATION_TOLERANCE_RATIO));
        if (totalMs < lower || totalMs > upper) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        SummaryProposal proposal = new SummaryProposal();
        proposal.setMediaJobStageId(stageId);
        proposal.setGeneratedBy(SummaryProposal.GeneratedBy.AI);
        proposal.setGenerationRound(round);
        proposal.setFeedbackText(feedbackText);
        proposal.setScriptContent(result.scriptContent());
        proposal.setScriptLanguage(result.scriptLanguage());
        proposal.setReasoningNote(result.reasoningNote());
        proposal.setTotalDurationMs(totalMs);
        proposal.setConfidence(result.confidence());
        proposal.setWarnings(toJsonArray(result.warnings()));
        proposal.setCreatedAt(Instant.now());
        proposal = summaryProposalRepository.save(proposal);

        int seq = 1;
        for (SummaryAiClient.SegmentDraft seg : result.segments()) {
            SummaryProposalSegment segment = new SummaryProposalSegment();
            segment.setProposalId(proposal.getId());
            segment.setSeq(seq++);
            segment.setStartMs(seg.startMs());
            segment.setEndMs(seg.endMs());
            segment.setScriptExcerpt(seg.scriptExcerpt());
            segment.setSourceSentenceRefs(toJsonArray(seg.sourceSentenceRefs()));
            segment.setReasoningNote(seg.reasoningNote());
            segment.setCreatedAt(Instant.now());
            summaryProposalSegmentRepository.save(segment);
        }
        return proposal;
    }

    private String toJsonArray(List<String> values) {
        try {
            return objectMapper.writeValueAsString(values == null ? List.of() : values);
        } catch (Exception e) {
            return "[]";
        }
    }
}
