package com.app.modules.guide.service;

import com.app.modules.guide.dto.GuideArticleDto;
import com.app.modules.guide.dto.GuideArticleRequest;
import com.app.modules.guide.dto.GuideCategoryDto;
import com.app.modules.guide.dto.GuideCategoryRequest;
import com.app.modules.guide.dto.GuideMoveRequest;
import com.app.modules.guide.entity.GuideArticleStatus;

import java.util.List;
import java.util.UUID;

public interface GuideService {

    // --- Public API ---
    List<GuideCategoryDto> listPublishedCategories(String lang);
    List<GuideArticleDto> searchPublishedArticles(UUID categoryId, String q, String lang);
    GuideArticleDto getPublishedArticleBySlug(String slug, String lang);

    // --- Platform Super Admin API ---
    List<GuideCategoryDto> listAdminCategories(UUID adminId);
    GuideCategoryDto getAdminCategory(UUID adminId, UUID id);
    GuideCategoryDto createCategory(UUID adminId, GuideCategoryRequest request);
    GuideCategoryDto updateCategory(UUID adminId, UUID id, GuideCategoryRequest request);
    void deleteCategory(UUID adminId, UUID id);
    GuideCategoryDto moveCategory(UUID adminId, UUID id, GuideMoveRequest request);

    List<GuideArticleDto> listAdminArticles(UUID adminId, UUID categoryId, String q, GuideArticleStatus status);
    GuideArticleDto getAdminArticle(UUID adminId, UUID id);
    GuideArticleDto createArticle(UUID adminId, GuideArticleRequest request);
    GuideArticleDto updateArticle(UUID adminId, UUID id, GuideArticleRequest request);
    void deleteArticle(UUID adminId, UUID id);
    GuideArticleDto setPublishStatus(UUID adminId, UUID id, GuideArticleStatus status);
    GuideArticleDto previewArticle(UUID adminId, UUID id, String lang);
}
