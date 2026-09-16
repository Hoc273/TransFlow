package com.app.modules.summarization.repository;

import com.app.modules.summarization.entity.SummaryProposal;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SummaryProposalRepository extends JpaRepository<SummaryProposal, UUID> {

    List<SummaryProposal> findByMediaJobStageIdAndArchivedAtIsNull(UUID mediaJobStageId);

    Optional<SummaryProposal> findByIdAndMediaJobStageId(UUID id, UUID mediaJobStageId);

    Optional<SummaryProposal> findTopByMediaJobStageIdAndGeneratedByOrderByGenerationRoundDesc(
            UUID mediaJobStageId, SummaryProposal.GeneratedBy generatedBy);
}
