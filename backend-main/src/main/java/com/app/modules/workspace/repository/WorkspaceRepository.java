package com.app.modules.workspace.repository;

import com.app.modules.workspace.entity.Workspace;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface WorkspaceRepository extends JpaRepository<Workspace, UUID> {

    List<Workspace> findByOwnerUserId(UUID ownerUserId);

    boolean existsBySlug(String slug);

    Optional<Workspace> findBySlug(String slug);

    @Query("SELECT w FROM Workspace w WHERE (:q IS NULL OR LOWER(w.name) LIKE LOWER(CONCAT('%', :q, '%')) OR LOWER(w.slug) LIKE LOWER(CONCAT('%', :q, '%')))")
    Page<Workspace> searchAdmin(@Param("q") String q, Pageable pageable);

    long countByCreatedAtBetween(Instant from, Instant to);
}
