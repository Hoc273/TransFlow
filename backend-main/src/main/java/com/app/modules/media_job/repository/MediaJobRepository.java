package com.app.modules.media_job.repository;

import com.app.modules.media_job.entity.MediaJob;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MediaJobRepository extends JpaRepository<MediaJob, UUID> {

    Optional<MediaJob> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<MediaJob> findWithLockById(UUID id);

    List<MediaJob> findByWorkspaceIdAndProjectId(UUID workspaceId, UUID projectId);

    List<MediaJob> findByWorkspaceIdAndProjectIdAndStatus(UUID workspaceId, UUID projectId, MediaJob.JobStatus status);

    List<MediaJob> findByWorkspaceIdAndProjectIdAndRecipeId(UUID workspaceId, UUID projectId, String recipeId);

    List<MediaJob> findByWorkspaceIdAndProjectIdAndStatusAndRecipeId(
            UUID workspaceId, UUID projectId, MediaJob.JobStatus status, String recipeId);

    List<MediaJob> findByBatchIdOrderByCreatedAtAsc(UUID batchId);

    // ── Maintenance (reconciler / retention) ──────────────────────────────────

    /** Open jobs not touched since {@code before}: candidates for re-dispatch. */
    @Query("select j.id from MediaJob j where j.status in :statuses and j.updatedAt < :before")
    List<UUID> findIdsByStatusInAndUpdatedAtBefore(@Param("statuses") Collection<MediaJob.JobStatus> statuses,
                                                   @Param("before") Instant before);

    /** Open jobs whose source video was already deleted by the retention sweep. */
    @Query("""
            select j.id from MediaJob j, com.app.modules.media_asset.entity.MediaAsset a
            where a.id = j.rootAssetId and a.purgedAt is not null and j.status in :statuses
            """)
    List<UUID> findIdsWithPurgedRootAsset(@Param("statuses") Collection<MediaJob.JobStatus> statuses);

    @Query("select j.rootAssetId from MediaJob j where j.id in :ids")
    List<UUID> findRootAssetIds(@Param("ids") Collection<UUID> ids);

    /** Recent jobs of the same author and language: measured TTS history for narration pacing. */
    List<MediaJob> findTop20ByCreatedByUserIdAndTargetLangAndIdNotOrderByCreatedAtDesc(
            UUID createdByUserId, String targetLang, UUID excludedJobId);

    // ── Platform-wide aggregates (SUPER ADMIN) ─────────────────────────────────

    interface MediaJobAggregateRow {
        MediaJob.JobStatus getStatus();
        MediaJob.ProcessingMode getProcessingMode();
        String getRecipeId();
        MediaJob.OutputAudioMode getOutputAudioMode();
        Long getCount();
    }

    interface WorkspaceJobCount {
        UUID getWorkspaceId();
        Long getJobCount();
    }

    @Query("""
            select j.status as status,
                   j.processingMode as processingMode,
                   j.recipeId as recipeId,
                   j.outputAudioMode as outputAudioMode,
                   count(j) as count
            from MediaJob j
            where j.createdAt >= :from and j.createdAt <= :to
            group by j.status, j.processingMode, j.recipeId, j.outputAudioMode
            """)
    List<MediaJobAggregateRow> aggregateJobsInRange(@Param("from") Instant from,
                                                    @Param("to") Instant to);

    @Query("""
            select j.workspaceId as workspaceId,
                   count(j) as jobCount
            from MediaJob j
            where j.createdAt >= :from and j.createdAt <= :to
            group by j.workspaceId
            """)
    List<WorkspaceJobCount> countJobsByWorkspaceInRange(@Param("from") Instant from,
                                                        @Param("to") Instant to);

    // ── Realtime polling queries ──────────────────────────────────────────────

    /** Count all jobs currently in the given status (live snapshot). */
    long countByStatus(MediaJob.JobStatus status);

    /** Count jobs in the given status created on or after the given instant. */
    long countByStatusAndCreatedAtAfter(MediaJob.JobStatus status, Instant after);
}

