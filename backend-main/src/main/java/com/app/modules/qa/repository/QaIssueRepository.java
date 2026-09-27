package com.app.modules.qa.repository;

import com.app.modules.qa.entity.QaIssue;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface QaIssueRepository extends JpaRepository<QaIssue, UUID> {

    List<QaIssue> findBySubtitleSegmentIdIn(List<UUID> subtitleSegmentIds);

    List<QaIssue> findBySubtitleSegmentIdInAndResolvedAtIsNull(List<UUID> subtitleSegmentIds);

    List<QaIssue> findBySubtitleSegmentIdInAndResolvedAtIsNotNull(List<UUID> subtitleSegmentIds);
}
