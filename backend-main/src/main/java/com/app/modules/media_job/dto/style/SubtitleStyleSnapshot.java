package com.app.modules.media_job.dto.style;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Canonical 13-field subtitle style: what is stored in {@code media_jobs.subtitle_style} and returned by the API.
 * snake_case on the wire on purpose — the existing frontend (types/subtitleStyle.ts) is built on it.
 * Ranges: fontFamily Arial|DejaVu Sans, fontSize 16-120, colors #RRGGBB, outlineWidth 0-8,
 * alignment left|center|right, background #RRGGBBAA (null = no box), opacity 0-100.
 */
public record SubtitleStyleSnapshot(
        @JsonProperty("font_family") String fontFamily,
        @JsonProperty("font_size") int fontSize,
        @JsonProperty("primary_color") String primaryColor,
        @JsonProperty("outline_color") String outlineColor,
        @JsonProperty("outline_width") int outlineWidth,
        @JsonProperty("shadow") boolean shadow,
        @JsonProperty("bold") boolean bold,
        @JsonProperty("italic") boolean italic,
        @JsonProperty("alignment") String alignment,
        @JsonProperty("margin_v") int marginV,
        @JsonProperty("line_spacing") int lineSpacing,
        @JsonInclude(JsonInclude.Include.NON_NULL) @JsonProperty("background") String background,
        @JsonProperty("opacity") int opacity) {
}
