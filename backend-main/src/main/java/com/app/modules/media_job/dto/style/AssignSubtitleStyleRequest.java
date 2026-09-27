package com.app.modules.media_job.dto.style;

/** {@code POST .../subtitle-style} body; the key is validated in the service (INVALID_STYLE_KEY / STYLE_NOT_FOUND). */
public record AssignSubtitleStyleRequest(String key) {
}
