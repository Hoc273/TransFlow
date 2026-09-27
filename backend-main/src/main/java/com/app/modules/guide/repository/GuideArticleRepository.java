package com.app.modules.guide.repository;

import com.app.modules.guide.entity.GuideArticle;
import com.app.modules.guide.entity.GuideArticleStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface GuideArticleRepository extends JpaRepository<GuideArticle, UUID> {
    Optional<GuideArticle> findBySlug(String slug);
    List<GuideArticle> findByStatusOrderByOrderIndexAsc(GuideArticleStatus status);
    List<GuideArticle> findByCategoryIdAndStatusOrderByOrderIndexAsc(UUID categoryId, GuideArticleStatus status);
    List<GuideArticle> findByCategoryIdOrderByOrderIndexAsc(UUID categoryId);
    long countByCategoryId(UUID categoryId);
    long countByCategoryIdAndStatus(UUID categoryId, GuideArticleStatus status);
    boolean existsBySlugAndIdNot(String slug, UUID id);
    boolean existsBySlug(String slug);

    @Query("SELECT a FROM GuideArticle a WHERE a.status = :status " +
           "AND (:categoryId IS NULL OR a.category.id = :categoryId) " +
           "AND (:q IS NULL OR :q = '' " +
           "OR LOWER(a.titleVi) LIKE LOWER(CONCAT('%', :q, '%')) " +
           "OR LOWER(a.titleEn) LIKE LOWER(CONCAT('%', :q, '%')) " +
           "OR LOWER(a.excerptVi) LIKE LOWER(CONCAT('%', :q, '%')) " +
           "OR LOWER(a.excerptEn) LIKE LOWER(CONCAT('%', :q, '%')) " +
           "OR LOWER(a.contentVi) LIKE LOWER(CONCAT('%', :q, '%')) " +
           "OR LOWER(a.contentEn) LIKE LOWER(CONCAT('%', :q, '%'))) " +
           "ORDER BY a.orderIndex ASC")
    List<GuideArticle> searchPublished(@Param("categoryId") UUID categoryId,
                                       @Param("q") String q,
                                       @Param("status") GuideArticleStatus status);

    @Query("SELECT a FROM GuideArticle a WHERE " +
           "(:categoryId IS NULL OR a.category.id = :categoryId) " +
           "AND (:status IS NULL OR a.status = :status) " +
           "AND (:q IS NULL OR :q = '' " +
           "OR LOWER(a.titleVi) LIKE LOWER(CONCAT('%', :q, '%')) " +
           "OR LOWER(a.titleEn) LIKE LOWER(CONCAT('%', :q, '%')) " +
           "OR LOWER(a.slug) LIKE LOWER(CONCAT('%', :q, '%'))) " +
           "ORDER BY a.orderIndex ASC")
    List<GuideArticle> searchAdmin(@Param("categoryId") UUID categoryId,
                                   @Param("q") String q,
                                   @Param("status") GuideArticleStatus status);
}
