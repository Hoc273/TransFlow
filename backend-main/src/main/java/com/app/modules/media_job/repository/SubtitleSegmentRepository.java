package com.app.modules.media_job.repository;

import com.app.modules.media_job.entity.SubtitleSegment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SubtitleSegmentRepository extends JpaRepository<SubtitleSegment, UUID> {

    List<SubtitleSegment> findByMediaJobIdOrderBySeq(UUID mediaJobId);

    Optional<SubtitleSegment> findByIdAndMediaJobId(UUID id, UUID mediaJobId);

    List<SubtitleSegment> findByIdInAndMediaJobId(Collection<UUID> ids, UUID mediaJobId);
}
