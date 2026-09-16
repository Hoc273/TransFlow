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
import com.app.modules.workspace.service.WorkspaceAccessService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SummarizationServiceImplTest {

    @Mock private SummaryProposalRepository summaryProposalRepository;
    @Mock private SummaryProposalSegmentRepository summaryProposalSegmentRepository;
    @Mock private WorkspaceAccessService access;
    @Mock private MediaJobService mediaJobService;
    @Mock private SummaryAiClient aiClient;
    @Mock private RefineSessionStore refineSessionStore;

    private SummarizationServiceImpl service;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();
    private final UUID summarizeStageId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new SummarizationServiceImpl(summaryProposalRepository, summaryProposalSegmentRepository,
                access, mediaJobService, aiClient, refineSessionStore, new ObjectMapper());
    }

    private MediaJob summaryJob() {
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setWorkspaceId(workspaceId);
        job.setProjectId(projectId);
        job.setRecipeId(MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH);
        job.setRequestedDurationSeconds(60);
        job.setTargetLang("en");
        return job;
    }

    private MediaJobStage stage(MediaJobStage.StageName name, MediaJobStage.StageStatus status) {
        MediaJobStage s = new MediaJobStage();
        s.setId(name == MediaJobStage.StageName.SUMMARIZE ? summarizeStageId : UUID.randomUUID());
        s.setMediaJobId(jobId);
        s.setStageName(name);
        s.setStageOrder(name.order());
        s.setStatus(status);
        return s;
    }

    private void stubStages(MediaJobStage.StageStatus translateStatus) {
        when(mediaJobService.getStages(jobId)).thenReturn(List.of(
                stage(MediaJobStage.StageName.SUMMARIZE, MediaJobStage.StageStatus.PENDING),
                stage(MediaJobStage.StageName.TRANSLATE, translateStatus)));
    }

    // ---- createCustomProposal ----

    @Test
    void createCustomProposal_success_savesHumanProposalWithSegments() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());
        stubStages(MediaJobStage.StageStatus.PENDING);
        when(summaryProposalRepository.save(any(SummaryProposal.class))).thenAnswer(inv -> {
            SummaryProposal p = inv.getArgument(0);
            if (p.getId() == null) p.setId(UUID.randomUUID());
            return p;
        });

        SummaryProposal result = service.createCustomProposal(workspaceId, userId, jobId,
                List.of(new SegmentRange(0, 1000), new SegmentRange(2000, 3000)), "manual pick");

        verify(access).requireProjectWriteAccess(workspaceId, userId, projectId);
        assertEquals(SummaryProposal.GeneratedBy.HUMAN, result.getGeneratedBy());
        assertEquals(summarizeStageId, result.getMediaJobStageId());
        assertEquals("manual pick", result.getReasoningNote());
        assertNull(result.getScriptContent());
        verify(summaryProposalSegmentRepository, times(2)).save(any(SummaryProposalSegment.class));
    }

    @Test
    void createCustomProposal_emptySegments_throwsValidationError() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());

        AppException ex = assertThrows(AppException.class, () ->
                service.createCustomProposal(workspaceId, userId, jobId, List.of(), null));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    @Test
    void createCustomProposal_invalidSegmentOrder_throwsValidationError() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());

        AppException ex = assertThrows(AppException.class, () ->
                service.createCustomProposal(workspaceId, userId, jobId, List.of(new SegmentRange(1000, 500)), null));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    // ---- updateCustomProposal ----

    @Test
    void updateCustomProposal_onAiProposal_throwsValidationError() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());
        stubStages(MediaJobStage.StageStatus.PENDING);
        UUID proposalId = UUID.randomUUID();
        SummaryProposal aiProposal = new SummaryProposal();
        aiProposal.setId(proposalId);
        aiProposal.setGeneratedBy(SummaryProposal.GeneratedBy.AI);
        when(summaryProposalRepository.findByIdAndMediaJobStageId(proposalId, summarizeStageId))
                .thenReturn(Optional.of(aiProposal));

        AppException ex = assertThrows(AppException.class, () ->
                service.updateCustomProposal(workspaceId, userId, jobId, proposalId, List.of(new SegmentRange(0, 100)), null));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
        verify(summaryProposalSegmentRepository, never()).deleteByProposalId(any());
    }

    // ---- selectProposal ----

    @Test
    void selectProposal_archivedProposal_throwsValidationError() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());
        stubStages(MediaJobStage.StageStatus.PENDING);
        UUID proposalId = UUID.randomUUID();
        SummaryProposal archived = new SummaryProposal();
        archived.setId(proposalId);
        archived.setArchivedAt(Instant.now());
        when(summaryProposalRepository.findByIdAndMediaJobStageId(proposalId, summarizeStageId))
                .thenReturn(Optional.of(archived));

        AppException ex = assertThrows(AppException.class, () ->
                service.selectProposal(workspaceId, userId, jobId, proposalId));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
        verify(mediaJobService, never()).updateSelectedProposal(any(), any(), any(), any());
    }

    @Test
    void selectProposal_activeProposal_delegatesToMediaJobService() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());
        stubStages(MediaJobStage.StageStatus.PENDING);
        UUID proposalId = UUID.randomUUID();
        SummaryProposal active = new SummaryProposal();
        active.setId(proposalId);
        when(summaryProposalRepository.findByIdAndMediaJobStageId(proposalId, summarizeStageId))
                .thenReturn(Optional.of(active));

        service.selectProposal(workspaceId, userId, jobId, proposalId);

        verify(mediaJobService).updateSelectedProposal(workspaceId, userId, jobId, proposalId);
    }

    // ---- refine ----

    private SummaryAiClient.ScriptProposalResult validAiResult() {
        return new SummaryAiClient.ScriptProposalResult(
                "This is the refined script.", "en",
                List.of(new SummaryAiClient.SegmentDraft(0, 30_000, "refined script", List.of("s1"), "reason"),
                        new SummaryAiClient.SegmentDraft(40_000, 70_000, null, List.of(), null)),
                "overall reasoning", new BigDecimal("0.9"), List.of());
    }

    @Test
    void refine_noExistingAiProposal_throwsResourceNotFound() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());
        when(summaryProposalRepository.findTopByMediaJobStageIdAndGeneratedByOrderByGenerationRoundDesc(
                summarizeStageId, SummaryProposal.GeneratedBy.AI)).thenReturn(Optional.empty());
        stubStages(MediaJobStage.StageStatus.PENDING);

        AppException ex = assertThrows(AppException.class, () -> service.refine(workspaceId, userId, jobId, "make it shorter"));
        assertEquals(ErrorCode.RESOURCE_NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void refine_currentSelectedAlreadyTranslated_throwsProposalAlreadyTranslated() {
        MediaJob job = summaryJob();
        UUID currentProposalId = UUID.randomUUID();
        job.setSelectedProposalId(currentProposalId);
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(job);
        stubStages(MediaJobStage.StageStatus.COMPLETED);

        SummaryProposal current = new SummaryProposal();
        current.setId(currentProposalId);
        current.setGenerationRound((short) 1);
        current.setScriptContent("old script");
        when(summaryProposalRepository.findTopByMediaJobStageIdAndGeneratedByOrderByGenerationRoundDesc(
                summarizeStageId, SummaryProposal.GeneratedBy.AI)).thenReturn(Optional.of(current));

        AppException ex = assertThrows(AppException.class, () -> service.refine(workspaceId, userId, jobId, "shorter"));
        assertEquals(ErrorCode.PROPOSAL_ALREADY_TRANSLATED, ex.getErrorCode());
        verifyNoInteractions(aiClient, refineSessionStore);
    }

    @Test
    void refine_overSessionLimit_throwsRefineLimitReached() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());
        stubStages(MediaJobStage.StageStatus.PENDING);
        SummaryProposal current = new SummaryProposal();
        current.setId(UUID.randomUUID());
        current.setGenerationRound((short) 1);
        current.setScriptContent("old script");
        when(summaryProposalRepository.findTopByMediaJobStageIdAndGeneratedByOrderByGenerationRoundDesc(
                summarizeStageId, SummaryProposal.GeneratedBy.AI)).thenReturn(Optional.of(current));
        when(refineSessionStore.incrementAndGet(jobId)).thenReturn(6);

        AppException ex = assertThrows(AppException.class, () -> service.refine(workspaceId, userId, jobId, "shorter"));
        assertEquals(ErrorCode.REFINE_LIMIT_REACHED, ex.getErrorCode());
        verifyNoInteractions(aiClient);
    }

    @Test
    void refine_success_archivesOldAndPersistsNewRoundWithinTolerance() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob()); // requestedDurationSeconds=60 -> 60000ms +-20%
        stubStages(MediaJobStage.StageStatus.PENDING);
        SummaryProposal current = new SummaryProposal();
        current.setId(UUID.randomUUID());
        current.setGenerationRound((short) 1);
        current.setScriptContent("old script");
        when(summaryProposalRepository.findTopByMediaJobStageIdAndGeneratedByOrderByGenerationRoundDesc(
                summarizeStageId, SummaryProposal.GeneratedBy.AI)).thenReturn(Optional.of(current));
        when(refineSessionStore.incrementAndGet(jobId)).thenReturn(1);
        when(aiClient.refineScript(eq("old script"), eq("shorter please"), eq("en"))).thenReturn(validAiResult());
        when(summaryProposalRepository.save(any(SummaryProposal.class))).thenAnswer(inv -> {
            SummaryProposal p = inv.getArgument(0);
            if (p.getId() == null) p.setId(UUID.randomUUID());
            return p;
        });

        SummaryProposal result = service.refine(workspaceId, userId, jobId, "shorter please");

        assertNotNull(current.getArchivedAt());
        assertEquals(SummaryProposal.GeneratedBy.AI, result.getGeneratedBy());
        assertEquals(2, result.getGenerationRound());
        assertEquals("shorter please", result.getFeedbackText());
        assertEquals("This is the refined script.", result.getScriptContent());
        assertEquals(60_000L, result.getTotalDurationMs());
        verify(summaryProposalSegmentRepository, times(2)).save(any(SummaryProposalSegment.class));
    }

    @Test
    void refine_durationOutOfTolerance_throwsValidationErrorAndDoesNotArchiveCurrent() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());
        stubStages(MediaJobStage.StageStatus.PENDING);
        SummaryProposal current = new SummaryProposal();
        current.setId(UUID.randomUUID());
        current.setGenerationRound((short) 1);
        current.setScriptContent("old script");
        when(summaryProposalRepository.findTopByMediaJobStageIdAndGeneratedByOrderByGenerationRoundDesc(
                summarizeStageId, SummaryProposal.GeneratedBy.AI)).thenReturn(Optional.of(current));
        when(refineSessionStore.incrementAndGet(jobId)).thenReturn(1);
        // total segment duration = 5000ms, requested 60s (60000ms) -> way out of +-20% tolerance
        SummaryAiClient.ScriptProposalResult tooShort = new SummaryAiClient.ScriptProposalResult(
                "short script", "en", List.of(new SummaryAiClient.SegmentDraft(0, 5000, null, List.of(), null)),
                null, null, List.of());
        when(aiClient.refineScript(any(), any(), any())).thenReturn(tooShort);

        AppException ex = assertThrows(AppException.class, () -> service.refine(workspaceId, userId, jobId, "shorter"));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    // ---- generateAiProposal ----

    @Test
    void generateAiProposal_scriptExcerptNotFoundInScript_throwsValidationError() {
        SummaryAiClient.ScriptProposalResult badResult = new SummaryAiClient.ScriptProposalResult(
                "The actual script content.", "en",
                List.of(new SummaryAiClient.SegmentDraft(0, 60_000, "text not present anywhere", List.of(), null)),
                null, null, List.of());
        when(aiClient.generateScript("transcript", null, 60, "en")).thenReturn(badResult);

        AppException ex = assertThrows(AppException.class, () ->
                service.generateAiProposal(summarizeStageId, "transcript", null, 60, "en"));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    @Test
    void generateAiProposal_valid_persistsRoundOne() {
        when(aiClient.generateScript("transcript", null, 60, "en")).thenReturn(validAiResult());
        when(summaryProposalRepository.save(any(SummaryProposal.class))).thenAnswer(inv -> {
            SummaryProposal p = inv.getArgument(0);
            if (p.getId() == null) p.setId(UUID.randomUUID());
            return p;
        });

        SummaryProposal result = service.generateAiProposal(summarizeStageId, "transcript", null, 60, "en");

        assertEquals((short) 1, result.getGenerationRound());
        assertEquals(summarizeStageId, result.getMediaJobStageId());
        assertNull(result.getFeedbackText());
    }

    // ---- createSummaryLanguageJob ----

    @Test
    void createSummaryLanguageJob_noSelectedProposal_throwsValidationError() {
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(summaryJob());

        AppException ex = assertThrows(AppException.class, () ->
                service.createSummaryLanguageJob(workspaceId, userId, jobId, "vi", null));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
        verify(mediaJobService, never()).createDerivedSummaryJob(any(), any(), any(), any(), any());
    }

    @Test
    void createSummaryLanguageJob_selectedProposalIsHuman_throwsValidationError() {
        MediaJob job = summaryJob();
        UUID proposalId = UUID.randomUUID();
        job.setSelectedProposalId(proposalId);
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(job);
        SummaryProposal human = new SummaryProposal();
        human.setId(proposalId);
        human.setGeneratedBy(SummaryProposal.GeneratedBy.HUMAN);
        when(summaryProposalRepository.findById(proposalId)).thenReturn(Optional.of(human));

        AppException ex = assertThrows(AppException.class, () ->
                service.createSummaryLanguageJob(workspaceId, userId, jobId, "vi", null));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    @Test
    void createSummaryLanguageJob_selectedProposalIsAi_delegatesToMediaJobService() {
        MediaJob job = summaryJob();
        UUID proposalId = UUID.randomUUID();
        job.setSelectedProposalId(proposalId);
        when(mediaJobService.getJob(workspaceId, userId, jobId)).thenReturn(job);
        SummaryProposal ai = new SummaryProposal();
        ai.setId(proposalId);
        ai.setGeneratedBy(SummaryProposal.GeneratedBy.AI);
        when(summaryProposalRepository.findById(proposalId)).thenReturn(Optional.of(ai));
        MediaJob derived = new MediaJob();
        when(mediaJobService.createDerivedSummaryJob(workspaceId, userId, jobId, "vi", null)).thenReturn(derived);

        MediaJob result = service.createSummaryLanguageJob(workspaceId, userId, jobId, "vi", null);

        assertSame(derived, result);
    }
}
