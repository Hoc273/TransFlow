package com.app.modules.media_job.repository;

import com.app.modules.media_job.entity.MediaJob;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.stereotype.Repository;

import jakarta.persistence.LockModeType;
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
}
