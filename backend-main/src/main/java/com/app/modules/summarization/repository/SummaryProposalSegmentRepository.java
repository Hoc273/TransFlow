package com.app.modules.summarization.repository;

import com.app.modules.summarization.entity.SummaryProposalSegment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface SummaryProposalSegmentRepository extends JpaRepository<SummaryProposalSegment, UUID> {

    List<SummaryProposalSegment> findByProposalIdOrderBySeq(UUID proposalId);

    void deleteByProposalId(UUID proposalId);
}
