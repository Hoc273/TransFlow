package com.app.modules.media_job.service;

import com.app.modules.media_job.dto.CreateMediaJobRequest;
import com.app.modules.media_job.dto.PatchSubtitleRequest;
import com.app.modules.media_job.entity.Checkpoint;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;

import java.util.List;
import java.util.UUID;

/**
 * Media Job orchestrator — Localization + Summarization (API_Contract.md §5,
 * Database_Design.md §6.2-6.3, Backend_Java_TaskSplit_MemberB.md §2.2).
 */
public interface MediaJobService {

    MediaJob createJob(UUID workspaceId, UUID userId, CreateMediaJobRequest request);

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
     * Shared job-ownership rule (System_Architecture.md §4.2): CLIENT always denied, LEAD always
     * allowed, MEMBER only on jobs they created. Reused by the future qa module for issue overrides.
     */
    void requireJobOwnership(UUID workspaceId, UUID userId, MediaJob job);
}
