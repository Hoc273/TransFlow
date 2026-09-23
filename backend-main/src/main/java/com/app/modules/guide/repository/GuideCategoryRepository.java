package com.app.modules.guide.repository;

import com.app.modules.guide.entity.GuideCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface GuideCategoryRepository extends JpaRepository<GuideCategory, UUID> {
    Optional<GuideCategory> findBySlug(String slug);
    List<GuideCategory> findAllByOrderByOrderIndexAsc();
    List<GuideCategory> findByPublishedTrueOrderByOrderIndexAsc();
    boolean existsBySlug(String slug);
    boolean existsBySlugAndIdNot(String slug, UUID id);
}
