package com.app.modules.guide;

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
import com.app.modules.guide.service.impl.GuideServiceImpl;
import com.app.modules.platform.service.PlatformAdminAccessService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class GuideServiceTest {

    @Mock
    private GuideCategoryRepository categoryRepository;

    @Mock
    private GuideArticleRepository articleRepository;

    @Mock
    private PlatformAdminAccessService adminAccess;

    @InjectMocks
    private GuideServiceImpl guideService;

    private UUID adminId;
    private UUID categoryId;
    private UUID articleId;
    private GuideCategory category;
    private GuideArticle article;

    @BeforeEach
    void setUp() {
        adminId = UUID.randomUUID();
        categoryId = UUID.randomUUID();
        articleId = UUID.randomUUID();

        category = new GuideCategory();
        category.setId(categoryId);
        category.setSlug("bat-dau");
        category.setTitleVi("Bắt đầu");
        category.setTitleEn("Getting Started");
        category.setOrderIndex(0);
        category.setPublished(true);

        article = new GuideArticle();
        article.setId(articleId);
        article.setCategory(category);
        article.setSlug("bai-viet-1");
        article.setTitleVi("Bài viết 1");
        article.setTitleEn("Article 1");
        article.setContentVi("Nội dung tiếng Việt");
        article.setContentEn("Content in English");
        article.setStatus(GuideArticleStatus.PUBLISHED);
        article.setOrderIndex(0);
    }

    @Test
    @DisplayName("Public list categories returns published categories with counts and localized title")
    void listPublishedCategories_success() {
        when(categoryRepository.findByPublishedTrueOrderByOrderIndexAsc()).thenReturn(List.of(category));
        when(articleRepository.countByCategoryIdAndStatus(categoryId, GuideArticleStatus.PUBLISHED)).thenReturn(3L);

        List<GuideCategoryDto> resultVi = guideService.listPublishedCategories("vi");
        assertThat(resultVi).hasSize(1);
        assertThat(resultVi.get(0).title()).isEqualTo("Bắt đầu");
        assertThat(resultVi.get(0).articleCount()).isEqualTo(3L);

        List<GuideCategoryDto> resultEn = guideService.listPublishedCategories("en");
        assertThat(resultEn).hasSize(1);
        assertThat(resultEn.get(0).title()).isEqualTo("Getting Started");
    }

    @Test
    @DisplayName("Public get article by slug returns published article")
    void getPublishedArticleBySlug_success() {
        when(articleRepository.findBySlug("bai-viet-1")).thenReturn(Optional.of(article));

        GuideArticleDto dto = guideService.getPublishedArticleBySlug("bai-viet-1", "vi");
        assertThat(dto).isNotNull();
        assertThat(dto.slug()).isEqualTo("bai-viet-1");
        assertThat(dto.title()).isEqualTo("Bài viết 1");
        assertThat(dto.categorySlug()).isEqualTo("bat-dau");
    }

    @Test
    @DisplayName("Public get article by slug throws 404 when slug not found")
    void getPublishedArticleBySlug_notFound() {
        when(articleRepository.findBySlug("khong-ton-tai")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> guideService.getPublishedArticleBySlug("khong-ton-tai", "vi"))
                .isInstanceOf(AppException.class)
                .satisfies(e -> assertThat(((AppException) e).getErrorCode()).isEqualTo(ErrorCode.GUIDE_ARTICLE_NOT_FOUND));
    }

    @Test
    @DisplayName("Public get article by slug throws 404 when article is DRAFT")
    void getPublishedArticleBySlug_draftThrows404() {
        article.setStatus(GuideArticleStatus.DRAFT);
        when(articleRepository.findBySlug("bai-viet-1")).thenReturn(Optional.of(article));

        assertThatThrownBy(() -> guideService.getPublishedArticleBySlug("bai-viet-1", "vi"))
                .isInstanceOf(AppException.class)
                .satisfies(e -> assertThat(((AppException) e).getErrorCode()).isEqualTo(ErrorCode.GUIDE_ARTICLE_NOT_FOUND));
    }

    @Test
    @DisplayName("Admin create category requires admin permission and auto generates slug")
    void createCategory_autoGeneratesSlug() {
        when(adminAccess.requirePlatformAdmin(adminId)).thenReturn(adminId);
        when(categoryRepository.existsBySlug("nang-cao")).thenReturn(false);
        when(categoryRepository.findAll()).thenReturn(List.of(category));
        when(categoryRepository.save(any(GuideCategory.class))).thenAnswer(i -> {
            GuideCategory saved = i.getArgument(0);
            saved.setId(UUID.randomUUID());
            return saved;
        });

        GuideCategoryRequest request = new GuideCategoryRequest(
                null, "Nâng cao", "Advanced", null, true);

        GuideCategoryDto created = guideService.createCategory(adminId, request);
        assertThat(created).isNotNull();
        assertThat(created.slug()).isEqualTo("nang-cao");
        assertThat(created.titleVi()).isEqualTo("Nâng cao");
        verify(adminAccess).requirePlatformAdmin(adminId);
    }

    @Test
    @DisplayName("Admin create category throws conflict when slug exists")
    void createCategory_duplicateSlugThrowsConflict() {
        when(adminAccess.requirePlatformAdmin(adminId)).thenReturn(adminId);
        when(categoryRepository.existsBySlug("bat-dau")).thenReturn(true);

        GuideCategoryRequest request = new GuideCategoryRequest(
                "bat-dau", "Bắt đầu 2", "Getting Started 2", 1, true);

        assertThatThrownBy(() -> guideService.createCategory(adminId, request))
                .isInstanceOf(AppException.class)
                .satisfies(e -> assertThat(((AppException) e).getErrorCode()).isEqualTo(ErrorCode.GUIDE_SLUG_ALREADY_EXISTS));
    }

    @Test
    @DisplayName("Admin delete category throws bad request when category has articles")
    void deleteCategory_withArticlesThrowsBadRequest() {
        when(adminAccess.requirePlatformAdmin(adminId)).thenReturn(adminId);
        when(categoryRepository.findById(categoryId)).thenReturn(Optional.of(category));
        when(articleRepository.countByCategoryId(categoryId)).thenReturn(2L);

        assertThatThrownBy(() -> guideService.deleteCategory(adminId, categoryId))
                .isInstanceOf(AppException.class)
                .satisfies(e -> assertThat(((AppException) e).getErrorCode()).isEqualTo(ErrorCode.GUIDE_CATEGORY_HAS_ARTICLES));

        verify(categoryRepository, never()).delete(any());
    }

    @Test
    @DisplayName("Admin delete category succeeds when category is empty")
    void deleteCategory_emptySucceeds() {
        when(adminAccess.requirePlatformAdmin(adminId)).thenReturn(adminId);
        when(categoryRepository.findById(categoryId)).thenReturn(Optional.of(category));
        when(articleRepository.countByCategoryId(categoryId)).thenReturn(0L);

        guideService.deleteCategory(adminId, categoryId);

        verify(categoryRepository).delete(category);
    }

    @Test
    @DisplayName("Admin move category swaps order indexes with adjacent category")
    void moveCategory_swapsOrder() {
        GuideCategory cat2 = new GuideCategory();
        UUID cat2Id = UUID.randomUUID();
        cat2.setId(cat2Id);
        cat2.setSlug("cat-2");
        cat2.setOrderIndex(1);

        when(adminAccess.requirePlatformAdmin(adminId)).thenReturn(adminId);
        when(categoryRepository.findById(cat2Id)).thenReturn(Optional.of(cat2));
        when(categoryRepository.findAllByOrderByOrderIndexAsc()).thenReturn(List.of(category, cat2));
        when(categoryRepository.save(any(GuideCategory.class))).thenAnswer(i -> i.getArgument(0));

        guideService.moveCategory(adminId, cat2Id, new GuideMoveRequest("UP", null));

        assertThat(cat2.getOrderIndex()).isEqualTo(0);
        assertThat(category.getOrderIndex()).isEqualTo(1);
    }

    @Test
    @DisplayName("Admin create article validates category exists and saves successfully")
    void createArticle_success() {
        when(adminAccess.requirePlatformAdmin(adminId)).thenReturn(adminId);
        when(categoryRepository.findById(categoryId)).thenReturn(Optional.of(category));
        when(articleRepository.existsBySlug("huong-dan-moi")).thenReturn(false);
        when(articleRepository.save(any(GuideArticle.class))).thenAnswer(i -> {
            GuideArticle saved = i.getArgument(0);
            saved.setId(UUID.randomUUID());
            return saved;
        });

        GuideArticleRequest request = new GuideArticleRequest(
                "huong-dan-moi",
                categoryId,
                "Hướng dẫn mới",
                "New Guide",
                "Tóm tắt",
                "Summary",
                "# Nội dung",
                "# Content",
                0,
                null,
                GuideArticleStatus.PUBLISHED
        );

        GuideArticleDto dto = guideService.createArticle(adminId, request);
        assertThat(dto).isNotNull();
        assertThat(dto.slug()).isEqualTo("huong-dan-moi");
        assertThat(dto.status()).isEqualTo(GuideArticleStatus.PUBLISHED);
    }

    @Test
    @DisplayName("Admin set publish status updates article status")
    void setPublishStatus_success() {
        when(adminAccess.requirePlatformAdmin(adminId)).thenReturn(adminId);
        when(articleRepository.findById(articleId)).thenReturn(Optional.of(article));
        when(articleRepository.save(any(GuideArticle.class))).thenAnswer(i -> i.getArgument(0));

        GuideArticleDto dto = guideService.setPublishStatus(adminId, articleId, GuideArticleStatus.DRAFT);
        assertThat(dto.status()).isEqualTo(GuideArticleStatus.DRAFT);
    }
}
