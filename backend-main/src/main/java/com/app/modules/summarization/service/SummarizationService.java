package com.app.modules.summarization.service;

import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.summarization.dto.SegmentRange;
import com.app.modules.summarization.entity.SummaryProposal;
import com.app.modules.summarization.entity.SummaryProposalSegment;

import java.util.List;
import java.util.UUID;

/**
 * Summarization proposal & refine (API_Contract.md §5.1, Database_Design.md §7,
 * Backend_Java_TaskSplit_MemberB.md §2.3).
 */
public interface SummarizationService {

    /** Active proposals for a job's SUMMARIZE stage: the latest AI round (if any) + every Custom Proposal. */
    List<SummaryProposal> listActiveProposals(UUID workspaceId, UUID userId, UUID jobId);

    List<SummaryProposalSegment> getSegments(UUID proposalId);

    SummaryProposal createCustomProposal(UUID workspaceId, UUID userId, UUID jobId, List<SegmentRange> segments, String reasoningNote);

    SummaryProposal updateCustomProposal(UUID workspaceId, UUID userId, UUID jobId, UUID proposalId,
                                          List<SegmentRange> segments, String reasoningNote);

    void selectProposal(UUID workspaceId, UUID userId, UUID jobId, UUID proposalId);

    SummaryProposal refine(UUID workspaceId, UUID userId, UUID jobId, String feedbackText);

    /** Generates and persists a round-1 AI proposal for a SUMMARIZE stage. */
    SummaryProposal generateAiProposal(UUID mediaJobStageId, String transcript, String visualContext,
                                        int requestedDurationSeconds, String targetLang);

    /** Arch §7.7 — "tóm tắt thêm ngôn ngữ", only when the source job's selected proposal is AI-generated. */
    MediaJob createSummaryLanguageJob(UUID workspaceId, UUID userId, UUID jobId, String targetLang,
                                      UUID ttsProviderId, UUID ttsVoiceId);

    SummaryProposal getProposalById(UUID proposalId);

    SummaryProposal persistAiProposalResult(UUID stageId, short round, SummaryAiClient.ScriptProposalResult result,
                                           String feedbackText, int requestedDurationSeconds);
}
