package com.app.modules.media_job.repository;

import com.app.modules.media_job.entity.MediaJob;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import jakarta.persistence.LockModeType;
import java.time.Instant;
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

