package com.app.modules.guide.controller;

import com.app.common.dto.ApiResponse;
import com.app.modules.guide.dto.GuideArticleDto;
import com.app.modules.guide.dto.GuideCategoryDto;
import com.app.modules.guide.service.GuideService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/guides")
@RequiredArgsConstructor
public class GuidePublicController {

    private final GuideService guideService;

    @GetMapping("/categories")
    public ApiResponse<List<GuideCategoryDto>> listCategories(
            @RequestParam(defaultValue = "vi") String lang) {
        return ApiResponse.<List<GuideCategoryDto>>builder()
                .data(guideService.listPublishedCategories(lang))
                .build();
    }

    @GetMapping("/articles")
    public ApiResponse<List<GuideArticleDto>> searchArticles(
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "vi") String lang) {
        return ApiResponse.<List<GuideArticleDto>>builder()
                .data(guideService.searchPublishedArticles(categoryId, q, lang))
                .build();
    }

    @GetMapping("/articles/{slug}")
    public ApiResponse<GuideArticleDto> getArticleBySlug(
            @PathVariable String slug,
            @RequestParam(defaultValue = "vi") String lang) {
        return ApiResponse.<GuideArticleDto>builder()
                .data(guideService.getPublishedArticleBySlug(slug, lang))
                .build();
    }
}
