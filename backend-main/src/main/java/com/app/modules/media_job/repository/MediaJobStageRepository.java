package com.app.modules.media_job.repository;

import com.app.modules.media_job.entity.MediaJobStage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MediaJobStageRepository extends JpaRepository<MediaJobStage, UUID> {

    List<MediaJobStage> findByMediaJobIdOrderByStageOrder(UUID mediaJobId);

    /** Stages of several jobs in one query (job list view). */
    List<MediaJobStage> findByMediaJobIdInOrderByStageOrder(Collection<UUID> mediaJobIds);

    Optional<MediaJobStage> findByMediaJobIdAndStageName(UUID mediaJobId, MediaJobStage.StageName stageName);

    /** Watchdog candidates: in-flight or cancelling attempts started before {@code cutoff}. */
    List<MediaJobStage> findByStatusInAndStartedAtBefore(Collection<MediaJobStage.StageStatus> statuses, Instant cutoff);
}
