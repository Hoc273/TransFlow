package com.app.modules.glossary.repository;

import com.app.modules.glossary.entity.Glossary;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface GlossaryRepository extends JpaRepository<Glossary, UUID> {

    Optional<Glossary> findByProjectId(UUID projectId);
}
