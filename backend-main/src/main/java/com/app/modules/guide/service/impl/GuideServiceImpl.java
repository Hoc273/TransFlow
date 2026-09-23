package com.app.modules.guide.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.guide.dto.GuideArticleDto;
import com.app.modules.guide.dto.GuideArticleRequest;
import com.app.modules.guide.dto.GuideCategoryDto;
import com.app.modules.guide.dto.GuideCategoryRequest;
import com.app.modules.guide.dto.GuideMoveRequest;
import com.app.modules.guide.entity.GuideArticle;
import com.app.modules.guide.entity.GuideArticleStatus;
import com.app.modules.guide.entity.GuideCategory;
import com.app.modules.guide.repository.GuideArticleRepository;
import com.app.modules.guide.repository.GuideCategoryRepository;
import com.app.modules.guide.service.GuideService;
import com.app.modules.guide.util.SlugUtils;
import com.app.modules.platform.service.PlatformAdminAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional
public class GuideServiceImpl implements GuideService {

    private final GuideCategoryRepository categoryRepository;
    private final GuideArticleRepository articleRepository;
    private final PlatformAdminAccessService adminAccess;

    // =========================================================================
    // Public API
    // =========================================================================

    @Override
    @Transactional(readOnly = true)
    public List<GuideCategoryDto> listPublishedCategories(String lang) {
        List<GuideCategory> categories = categoryRepository.findByPublishedTrueOrderByOrderIndexAsc();
        return categories.stream()
                .map(c -> {
                    long count = articleRepository.countByCategoryIdAndStatus(c.getId(), GuideArticleStatus.PUBLISHED);
                    return GuideCategoryDto.of(c, lang, count);
                })
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<GuideArticleDto> searchPublishedArticles(UUID categoryId, String q, String lang) {
        List<GuideArticle> articles = articleRepository.searchPublished(categoryId, q, GuideArticleStatus.PUBLISHED);
        return articles.stream()
                .filter(a -> a.getCategory() != null && a.getCategory().isPublished())
                .map(a -> GuideArticleDto.of(a, lang))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public GuideArticleDto getPublishedArticleBySlug(String slug, String lang) {
        GuideArticle article = articleRepository.findBySlug(slug)
                .filter(a -> a.getStatus() == GuideArticleStatus.PUBLISHED)
                .filter(a -> a.getCategory() != null && a.getCategory().isPublished())
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_ARTICLE_NOT_FOUND));
        return GuideArticleDto.of(article, lang);
    }

    // =========================================================================
    // Platform Super Admin API (Categories)
    // =========================================================================

    @Override
    @Transactional(readOnly = true)
    public List<GuideCategoryDto> listAdminCategories(UUID adminId) {
        adminAccess.requirePlatformAdmin(adminId);
        List<GuideCategory> categories = categoryRepository.findAllByOrderByOrderIndexAsc();
        return categories.stream()
                .map(c -> {
                    long count = articleRepository.countByCategoryId(c.getId());
                    return GuideCategoryDto.of(c, "vi", count);
                })
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public GuideCategoryDto getAdminCategory(UUID adminId, UUID id) {
        adminAccess.requirePlatformAdmin(adminId);
        GuideCategory cat = categoryRepository.findById(id)
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_CATEGORY_NOT_FOUND));
        long count = articleRepository.countByCategoryId(id);
        return GuideCategoryDto.of(cat, "vi", count);
    }

    @Override
    public GuideCategoryDto createCategory(UUID adminId, GuideCategoryRequest request) {
        adminAccess.requirePlatformAdmin(adminId);

        String slug = resolveSlug(request.slug(), request.titleVi());
        if (categoryRepository.existsBySlug(slug)) {
            throw new AppException(ErrorCode.GUIDE_SLUG_ALREADY_EXISTS);
        }

        GuideCategory category = new GuideCategory();
        category.setSlug(slug);
        category.setTitleVi(request.titleVi().trim());
        category.setTitleEn(request.titleEn().trim());
        category.setOrderIndex(request.orderIndex() != null ? request.orderIndex() : categoryRepository.findAll().size());
        category.setPublished(request.published() != null ? request.published() : true);

        category = categoryRepository.save(category);
        return GuideCategoryDto.of(category, "vi", 0);
    }

    @Override
    public GuideCategoryDto updateCategory(UUID adminId, UUID id, GuideCategoryRequest request) {
        adminAccess.requirePlatformAdmin(adminId);

        GuideCategory category = categoryRepository.findById(id)
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_CATEGORY_NOT_FOUND));

        if (request.slug() != null && !request.slug().isBlank()) {
            String slug = request.slug().toLowerCase(Locale.ROOT).trim();
            if (!SlugUtils.isValidSlug(slug)) {
                throw new AppException(ErrorCode.INVALID_SLUG_FORMAT);
            }
            if (categoryRepository.existsBySlugAndIdNot(slug, id)) {
                throw new AppException(ErrorCode.GUIDE_SLUG_ALREADY_EXISTS);
            }
            category.setSlug(slug);
        }

        if (request.titleVi() != null && !request.titleVi().isBlank()) {
            category.setTitleVi(request.titleVi().trim());
        }
        if (request.titleEn() != null && !request.titleEn().isBlank()) {
            category.setTitleEn(request.titleEn().trim());
        }
        if (request.orderIndex() != null) {
            category.setOrderIndex(request.orderIndex());
        }
        if (request.published() != null) {
            category.setPublished(request.published());
        }

        category = categoryRepository.save(category);
        long count = articleRepository.countByCategoryId(id);
        return GuideCategoryDto.of(category, "vi", count);
    }

    @Override
    public void deleteCategory(UUID adminId, UUID id) {
        adminAccess.requirePlatformAdmin(adminId);

        GuideCategory category = categoryRepository.findById(id)
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_CATEGORY_NOT_FOUND));

        long count = articleRepository.countByCategoryId(id);
        if (count > 0) {
            throw new AppException(ErrorCode.GUIDE_CATEGORY_HAS_ARTICLES);
        }

        categoryRepository.delete(category);
    }

    @Override
    public GuideCategoryDto moveCategory(UUID adminId, UUID id, GuideMoveRequest request) {
        adminAccess.requirePlatformAdmin(adminId);

        GuideCategory category = categoryRepository.findById(id)
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_CATEGORY_NOT_FOUND));

        if (request.orderIndex() != null) {
            category.setOrderIndex(request.orderIndex());
            category = categoryRepository.save(category);
        } else if ("UP".equalsIgnoreCase(request.direction())) {
            List<GuideCategory> list = categoryRepository.findAllByOrderByOrderIndexAsc();
            int idx = -1;
            for (int i = 0; i < list.size(); i++) {
                if (list.get(i).getId().equals(id)) {
                    idx = i;
                    break;
                }
            }
            if (idx > 0) {
                GuideCategory prev = list.get(idx - 1);
                int temp = category.getOrderIndex();
                category.setOrderIndex(prev.getOrderIndex());
                prev.setOrderIndex(temp);
                categoryRepository.save(prev);
                category = categoryRepository.save(category);
            }
        } else if ("DOWN".equalsIgnoreCase(request.direction())) {
            List<GuideCategory> list = categoryRepository.findAllByOrderByOrderIndexAsc();
            int idx = -1;
            for (int i = 0; i < list.size(); i++) {
                if (list.get(i).getId().equals(id)) {
                    idx = i;
                    break;
                }
            }
            if (idx >= 0 && idx < list.size() - 1) {
                GuideCategory next = list.get(idx + 1);
                int temp = category.getOrderIndex();
                category.setOrderIndex(next.getOrderIndex());
                next.setOrderIndex(temp);
                categoryRepository.save(next);
                category = categoryRepository.save(category);
            }
        }

        long count = articleRepository.countByCategoryId(id);
        return GuideCategoryDto.of(category, "vi", count);
    }

    // =========================================================================
    // Platform Super Admin API (Articles)
    // =========================================================================

    @Override
    @Transactional(readOnly = true)
    public List<GuideArticleDto> listAdminArticles(UUID adminId, UUID categoryId, String q, GuideArticleStatus status) {
        adminAccess.requirePlatformAdmin(adminId);
        List<GuideArticle> articles = articleRepository.searchAdmin(categoryId, q, status);
        return articles.stream()
                .map(a -> GuideArticleDto.of(a, "vi"))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public GuideArticleDto getAdminArticle(UUID adminId, UUID id) {
        adminAccess.requirePlatformAdmin(adminId);
        GuideArticle article = articleRepository.findById(id)
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_ARTICLE_NOT_FOUND));
        return GuideArticleDto.of(article, "vi");
    }

    @Override
    public GuideArticleDto createArticle(UUID adminId, GuideArticleRequest request) {
        adminAccess.requirePlatformAdmin(adminId);

        GuideCategory category = categoryRepository.findById(request.categoryId())
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_CATEGORY_NOT_FOUND));

        String slug = resolveSlug(request.slug(), request.titleVi());
        if (articleRepository.existsBySlug(slug)) {
            throw new AppException(ErrorCode.GUIDE_SLUG_ALREADY_EXISTS);
        }

        GuideArticle article = new GuideArticle();
        article.setCategory(category);
        article.setSlug(slug);
        article.setTitleVi(request.titleVi().trim());
        article.setTitleEn(request.titleEn().trim());
        article.setExcerptVi(request.excerptVi() != null ? request.excerptVi().trim() : null);
        article.setExcerptEn(request.excerptEn() != null ? request.excerptEn().trim() : null);
        article.setContentVi(request.contentVi());
        article.setContentEn(request.contentEn());
        article.setStatus(request.status() != null ? request.status() : GuideArticleStatus.DRAFT);
        article.setOrderIndex(request.orderIndex() != null ? request.orderIndex() : 0);
        article.setCoverImageUrl(request.coverImageUrl());

        article = articleRepository.save(article);
        return GuideArticleDto.of(article, "vi");
    }

    @Override
    public GuideArticleDto updateArticle(UUID adminId, UUID id, GuideArticleRequest request) {
        adminAccess.requirePlatformAdmin(adminId);

        GuideArticle article = articleRepository.findById(id)
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_ARTICLE_NOT_FOUND));

        if (request.categoryId() != null && (article.getCategory() == null || !article.getCategory().getId().equals(request.categoryId()))) {
            GuideCategory cat = categoryRepository.findById(request.categoryId())
                    .orElseThrow(() -> new AppException(ErrorCode.GUIDE_CATEGORY_NOT_FOUND));
            article.setCategory(cat);
        }

        if (request.slug() != null && !request.slug().isBlank()) {
            String slug = request.slug().toLowerCase(Locale.ROOT).trim();
            if (!SlugUtils.isValidSlug(slug)) {
                throw new AppException(ErrorCode.INVALID_SLUG_FORMAT);
            }
            if (articleRepository.existsBySlugAndIdNot(slug, id)) {
                throw new AppException(ErrorCode.GUIDE_SLUG_ALREADY_EXISTS);
            }
            article.setSlug(slug);
        }

        if (request.titleVi() != null && !request.titleVi().isBlank()) {
            article.setTitleVi(request.titleVi().trim());
        }
        if (request.titleEn() != null && !request.titleEn().isBlank()) {
            article.setTitleEn(request.titleEn().trim());
        }
        article.setExcerptVi(request.excerptVi() != null ? request.excerptVi().trim() : null);
        article.setExcerptEn(request.excerptEn() != null ? request.excerptEn().trim() : null);
        if (request.contentVi() != null) {
            article.setContentVi(request.contentVi());
        }
        if (request.contentEn() != null) {
            article.setContentEn(request.contentEn());
        }
        if (request.status() != null) {
            article.setStatus(request.status());
        }
        if (request.orderIndex() != null) {
            article.setOrderIndex(request.orderIndex());
        }
        article.setCoverImageUrl(request.coverImageUrl());

        article = articleRepository.save(article);
        return GuideArticleDto.of(article, "vi");
    }

    @Override
    public void deleteArticle(UUID adminId, UUID id) {
        adminAccess.requirePlatformAdmin(adminId);

        GuideArticle article = articleRepository.findById(id)
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_ARTICLE_NOT_FOUND));

        articleRepository.delete(article);
    }

    @Override
    public GuideArticleDto setPublishStatus(UUID adminId, UUID id, GuideArticleStatus status) {
        adminAccess.requirePlatformAdmin(adminId);

        GuideArticle article = articleRepository.findById(id)
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_ARTICLE_NOT_FOUND));

        article.setStatus(status);
        article = articleRepository.save(article);
        return GuideArticleDto.of(article, "vi");
    }

    @Override
    @Transactional(readOnly = true)
    public GuideArticleDto previewArticle(UUID adminId, UUID id, String lang) {
        adminAccess.requirePlatformAdmin(adminId);

        GuideArticle article = articleRepository.findById(id)
                .orElseThrow(() -> new AppException(ErrorCode.GUIDE_ARTICLE_NOT_FOUND));

        return GuideArticleDto.of(article, lang);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private String resolveSlug(String explicitSlug, String fallbackTitle) {
        String slug;
        if (explicitSlug != null && !explicitSlug.isBlank()) {
            slug = explicitSlug.toLowerCase(Locale.ROOT).trim();
        } else {
            slug = SlugUtils.toSlug(fallbackTitle);
        }
        if (!SlugUtils.isValidSlug(slug)) {
            throw new AppException(ErrorCode.INVALID_SLUG_FORMAT);
        }
        return slug;
    }
}
