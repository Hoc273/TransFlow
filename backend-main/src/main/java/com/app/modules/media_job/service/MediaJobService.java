package com.app.modules.media_job.service;

import com.app.modules.media_job.dto.CreateMediaJobRequest;
import com.app.modules.media_job.dto.PatchSubtitleRequest;
import com.app.modules.media_job.entity.Checkpoint;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Media Job orchestrator — Localization + Summarization (API_Contract.md §5,
 * Database_Design.md §6.2-6.3, Backend_Java_TaskSplit_MemberB.md §2.2).
 */
public interface MediaJobService {

    MediaJob createJob(UUID workspaceId, UUID userId, CreateMediaJobRequest request);

    /** Same validation/creation pipeline as {@link #createJob}, but stamps {@code batch_id} (batch module, §2.4). */
    MediaJob createBatchChildJob(UUID workspaceId, UUID userId, UUID batchId, CreateMediaJobRequest request);

    List<MediaJob> getJobsByBatch(UUID batchId);

    List<MediaJob> listJobs(UUID workspaceId, UUID userId, UUID projectId, MediaJob.JobStatus status, String recipeId);

    MediaJob getJob(UUID workspaceId, UUID userId, UUID jobId);

    List<MediaJobStage> getStages(UUID jobId);

    MediaJob cancelJob(UUID workspaceId, UUID userId, UUID jobId);

    MediaJob setVoice(UUID workspaceId, UUID userId, UUID jobId, UUID ttsVoiceId);

    void confirmCheckpoint(UUID workspaceId, UUID userId, UUID jobId, Checkpoint checkpoint);

    MediaJob rerunFromStage(UUID workspaceId, UUID userId, UUID jobId, MediaJobStage.StageName stageName);

    List<SubtitleSegment> listSubtitles(UUID workspaceId, UUID userId, UUID jobId);

    SubtitleSegment patchSubtitle(UUID workspaceId, UUID userId, UUID jobId, UUID segmentId, PatchSubtitleRequest request);

    /**
     * Sets {@code media_jobs.selected_proposal_id} (owned by this module). Rejects switching away from
     * a proposal whose TRANSLATE stage already COMPLETED (API_Contract.md §5.1 — re-selecting the same
     * proposal is a no-op). Callers (summarization module) validate the proposal itself belongs to this
     * job and isn't archived before calling this.
     */
    MediaJob updateSelectedProposal(UUID workspaceId, UUID userId, UUID jobId, UUID proposalId);

    /**
     * Creates the derived "summary in another language" job (Arch §7.7): copies the source job's asset/
     * preset/subtitle settings, sets {@code source_summary_job_id}, and only activates
     * TRANSLATE -> TTS(optional) -> RENDER. Callers (summarization module) validate the source job's
     * selected proposal is AI-generated before calling this.
     */
    MediaJob createDerivedSummaryJob(UUID workspaceId, UUID userId, UUID sourceJobId, String targetLang, UUID ttsVoiceId);

    /**
     * Shared job-ownership rule (System_Architecture.md §4.2): CLIENT always denied, LEAD always
     * allowed, MEMBER only on jobs they created. Reused by the qa module for issue overrides.
     */
    void requireJobOwnership(UUID workspaceId, UUID userId, MediaJob job);

    /** No auth check — for the qa module to resolve which job a {@code subtitle_segments} row belongs to. */
    Optional<SubtitleSegment> findSubtitleSegmentById(UUID segmentId);
}
