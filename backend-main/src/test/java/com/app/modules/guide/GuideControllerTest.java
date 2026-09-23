package com.app.modules.guide;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.common.exception.GlobalExceptionHandler;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.guide.controller.GuideAdminController;
import com.app.modules.guide.controller.GuidePublicController;
import com.app.modules.guide.dto.GuideArticleDto;
import com.app.modules.guide.dto.GuideCategoryDto;
import com.app.modules.guide.entity.GuideArticleStatus;
import com.app.modules.guide.service.GuideService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class GuideControllerTest {

    @Mock
    private GuideService guideService;

    @InjectMocks
    private GuidePublicController publicController;

    @InjectMocks
    private GuideAdminController adminController;

    private MockMvc publicMockMvc;
    private MockMvc adminMockMvc;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final UUID adminUserId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        publicMockMvc = MockMvcBuilders.standaloneSetup(publicController)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();

        HandlerMethodArgumentResolver authResolver = new HandlerMethodArgumentResolver() {
            @Override
            public boolean supportsParameter(MethodParameter parameter) {
                return parameter.getParameterType().equals(AuthenticatedUser.class);
            }

            @Override
            public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
                                          NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
                return new AuthenticatedUser(adminUserId, "admin@transflow.com");
            }
        };

        adminMockMvc = MockMvcBuilders.standaloneSetup(adminController)
                .setControllerAdvice(new GlobalExceptionHandler())
                .setCustomArgumentResolvers(authResolver)
                .build();
    }

    @Test
    @DisplayName("GET /api/guides/categories returns 200 with category list")
    void publicGetCategories_returns200() throws Exception {
        GuideCategoryDto dto = new GuideCategoryDto(
                UUID.randomUUID(), "bat-dau", "Bắt đầu", "Bắt đầu", "Getting Started",
                0, true, 2L, Instant.now(), Instant.now());
        when(guideService.listPublishedCategories("vi")).thenReturn(List.of(dto));

        publicMockMvc.perform(get("/api/guides/categories?lang=vi"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data[0].slug").value("bat-dau"))
                .andExpect(jsonPath("$.data[0].articleCount").value(2));
    }

    @Test
    @DisplayName("GET /api/guides/articles/{slug} returns 200 when slug exists")
    void publicGetArticleBySlug_returns200() throws Exception {
        GuideArticleDto dto = new GuideArticleDto(
                UUID.randomUUID(), UUID.randomUUID(), "bat-dau", "Bắt đầu",
                "tong-quan", "Tổng quan", "Tổng quan", "Overview",
                "Tóm tắt", "Tóm tắt", "Summary",
                "# Nội dung", "# Nội dung", "# Content",
                GuideArticleStatus.PUBLISHED, 0, null, Instant.now(), Instant.now());
        when(guideService.getPublishedArticleBySlug("tong-quan", "vi")).thenReturn(dto);

        publicMockMvc.perform(get("/api/guides/articles/tong-quan?lang=vi"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.slug").value("tong-quan"))
                .andExpect(jsonPath("$.data.title").value("Tổng quan"));
    }

    @Test
    @DisplayName("GET /api/guides/articles/{slug} returns 404 when slug does not exist")
    void publicGetUnknownSlug_returns404() throws Exception {
        when(guideService.getPublishedArticleBySlug("khong-ton-tai", "vi"))
                .thenThrow(new AppException(ErrorCode.GUIDE_ARTICLE_NOT_FOUND));

        publicMockMvc.perform(get("/api/guides/articles/khong-ton-tai?lang=vi"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(3403));
    }

    @Test
    @DisplayName("POST /api/platform/guides/categories returns 201 Created")
    void adminCreateCategory_returns201() throws Exception {
        GuideCategoryDto created = new GuideCategoryDto(
                UUID.randomUUID(), "bat-dau", "Bắt đầu", "Bắt đầu", "Getting Started",
                0, true, 0L, Instant.now(), Instant.now());
        when(guideService.createCategory(eq(adminUserId), any())).thenReturn(created);

        Map<String, Object> req = Map.of(
                "slug", "bat-dau",
                "titleVi", "Bắt đầu",
                "titleEn", "Getting Started"
        );

        adminMockMvc.perform(post("/api/platform/guides/categories")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.slug").value("bat-dau"));
    }

    @Test
    @DisplayName("DELETE /api/platform/guides/categories/{id} returns 400 when category has articles")
    void adminDeleteCategory_withArticles_returns400() throws Exception {
        UUID catId = UUID.randomUUID();
        doThrow(new AppException(ErrorCode.GUIDE_CATEGORY_HAS_ARTICLES))
                .when(guideService).deleteCategory(adminUserId, catId);

        adminMockMvc.perform(delete("/api/platform/guides/categories/" + catId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(3401));
    }
}
