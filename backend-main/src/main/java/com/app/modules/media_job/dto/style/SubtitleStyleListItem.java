package com.app.modules.media_job.dto.style;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/** {@code GET /api/media/subtitle-styles} item. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SubtitleStyleListItem(
        String key,
        String name,
        String language,
        String thumbnail,
        @JsonProperty("preview_text") String previewText,
        int revision) {

    public static SubtitleStyleListItem from(SubtitleStylePreset p) {
        return new SubtitleStyleListItem(p.key(), p.name(), p.language(), p.thumbnail(), p.previewText(), p.revision());
    }
}
