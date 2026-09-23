package com.app.modules.guide.dto;

import com.app.modules.guide.entity.GuideArticleStatus;
import jakarta.validation.constraints.NotNull;

public record GuidePublishRequest(
        @NotNull(message = "status is required")
        GuideArticleStatus status
) {}
