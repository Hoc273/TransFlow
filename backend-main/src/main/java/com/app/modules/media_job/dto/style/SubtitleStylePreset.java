package com.app.modules.media_job.dto.style;

import com.fasterxml.jackson.annotation.JsonProperty;

/** One entry of the built-in catalog ({@code subtitle-styles.json}); {@code key} is the stable public id. */
public record SubtitleStylePreset(
        String key,
        String name,
        String language,
        String thumbnail,
        @JsonProperty("preview_text") String previewText,
        int revision,
        SubtitleStyleSnapshot snapshot) {
}
