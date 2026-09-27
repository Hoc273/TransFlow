package com.app.modules.glossary.repository;

import com.app.modules.glossary.entity.GlossaryTerm;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface GlossaryTermRepository extends JpaRepository<GlossaryTerm, UUID> {

    List<GlossaryTerm> findByGlossaryId(UUID glossaryId);

    Optional<GlossaryTerm> findByIdAndGlossaryId(UUID id, UUID glossaryId);
}
