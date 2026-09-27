package com.app.modules.media_job.repository;

import com.app.modules.media_job.entity.SubtitleSegment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SubtitleSegmentRepository extends JpaRepository<SubtitleSegment, UUID> {

    List<SubtitleSegment> findByMediaJobIdOrderBySeq(UUID mediaJobId);

    Optional<SubtitleSegment> findByIdAndMediaJobId(UUID id, UUID mediaJobId);

    List<SubtitleSegment> findByIdInAndMediaJobId(Collection<UUID> ids, UUID mediaJobId);

    /** Re-materialise a translation attempt without violating UNIQUE(job_id, seq). */
    @Transactional
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from SubtitleSegment s where s.mediaJobId = :mediaJobId")
    int deleteByMediaJobId(@Param("mediaJobId") UUID mediaJobId);
}
