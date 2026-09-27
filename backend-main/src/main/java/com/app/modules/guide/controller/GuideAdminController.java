package com.app.modules.guide.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.guide.dto.GuideArticleDto;
import com.app.modules.guide.dto.GuideArticleRequest;
import com.app.modules.guide.dto.GuideCategoryDto;
import com.app.modules.guide.dto.GuideCategoryRequest;
import com.app.modules.guide.dto.GuideMoveRequest;
import com.app.modules.guide.dto.GuidePublishRequest;
import com.app.modules.guide.entity.GuideArticleStatus;
import com.app.modules.guide.service.GuideService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/platform/guides")
@RequiredArgsConstructor
public class GuideAdminController {

    private final GuideService guideService;

    // =========================================================================
    // Category Endpoints
    // =========================================================================

    @GetMapping("/categories")
    public ApiResponse<List<GuideCategoryDto>> listCategories(
            @AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<List<GuideCategoryDto>>builder()
                .data(guideService.listAdminCategories(user.id()))
                .build();
    }

    @GetMapping("/categories/{id}")
    public ApiResponse<GuideCategoryDto> getCategory(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID id) {
        return ApiResponse.<GuideCategoryDto>builder()
                .data(guideService.getAdminCategory(user.id(), id))
                .build();
    }

    @PostMapping("/categories")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<GuideCategoryDto> createCategory(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody GuideCategoryRequest request) {
        return ApiResponse.<GuideCategoryDto>builder()
                .data(guideService.createCategory(user.id(), request))
                .build();
    }

    @PutMapping("/categories/{id}")
    public ApiResponse<GuideCategoryDto> updateCategory(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID id,
            @Valid @RequestBody GuideCategoryRequest request) {
        return ApiResponse.<GuideCategoryDto>builder()
                .data(guideService.updateCategory(user.id(), id, request))
                .build();
    }

    @DeleteMapping("/categories/{id}")
    public ApiResponse<Void> deleteCategory(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID id) {
        guideService.deleteCategory(user.id(), id);
        return ApiResponse.<Void>builder().build();
    }

    @PatchMapping("/categories/{id}/move")
    public ApiResponse<GuideCategoryDto> moveCategory(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID id,
            @RequestBody GuideMoveRequest request) {
        return ApiResponse.<GuideCategoryDto>builder()
                .data(guideService.moveCategory(user.id(), id, request))
                .build();
    }

    // =========================================================================
    // Article Endpoints
    // =========================================================================

    @GetMapping("/articles")
    public ApiResponse<List<GuideArticleDto>> listArticles(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) GuideArticleStatus status) {
        return ApiResponse.<List<GuideArticleDto>>builder()
                .data(guideService.listAdminArticles(user.id(), categoryId, q, status))
                .build();
    }

    @GetMapping("/articles/{id}")
    public ApiResponse<GuideArticleDto> getArticle(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID id) {
        return ApiResponse.<GuideArticleDto>builder()
                .data(guideService.getAdminArticle(user.id(), id))
                .build();
    }

    @PostMapping("/articles")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<GuideArticleDto> createArticle(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody GuideArticleRequest request) {
        return ApiResponse.<GuideArticleDto>builder()
                .data(guideService.createArticle(user.id(), request))
                .build();
    }

    @PutMapping("/articles/{id}")
    public ApiResponse<GuideArticleDto> updateArticle(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID id,
            @Valid @RequestBody GuideArticleRequest request) {
        return ApiResponse.<GuideArticleDto>builder()
                .data(guideService.updateArticle(user.id(), id, request))
                .build();
    }

    @DeleteMapping("/articles/{id}")
    public ApiResponse<Void> deleteArticle(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID id) {
        guideService.deleteArticle(user.id(), id);
        return ApiResponse.<Void>builder().build();
    }

    @PatchMapping("/articles/{id}/publish")
    public ApiResponse<GuideArticleDto> setPublishStatus(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID id,
            @Valid @RequestBody GuidePublishRequest request) {
        return ApiResponse.<GuideArticleDto>builder()
                .data(guideService.setPublishStatus(user.id(), id, request.status()))
                .build();
    }

    @GetMapping("/articles/{id}/preview")
    public ApiResponse<GuideArticleDto> previewArticle(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID id,
            @RequestParam(defaultValue = "vi") String lang) {
        return ApiResponse.<GuideArticleDto>builder()
                .data(guideService.previewArticle(user.id(), id, lang))
                .build();
    }
}
