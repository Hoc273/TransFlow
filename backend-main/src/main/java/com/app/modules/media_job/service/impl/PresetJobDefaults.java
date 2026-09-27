package com.app.modules.media_job.service.impl;

import com.app.modules.media_job.dto.render.RenderPresentation;
import com.app.modules.media_job.dto.render.UpdateRenderConfigRequest;
import com.app.modules.media_job.dto.style.SubtitleStyleSnapshot;
import com.app.modules.preset.service.PresetResolverService.PresetJobConfig;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.Set;
import java.util.regex.Pattern;

/**
 * Turns a resolved preset into the job's initial render config / subtitle style (API_Contract.md §9:
 * the preset is frozen into the job at creation). Preset JSON is tenant-editable, so only values the
 * render pipeline accepts are taken; anything else is dropped and falls back to the job default.
 */
final class PresetJobDefaults {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Pattern RGB = Pattern.compile("^#[0-9A-Fa-f]{6}$");
    private static final Pattern RGBA = Pattern.compile("^#[0-9A-Fa-f]{8}$");
    private static final Set<String> SUBTITLE_MODES = Set.of("HARD_SUB", "SOFT_SUB");
    private static final Set<String> POSITIONS = Set.of("TOP", "CENTER", "BOTTOM");
    private static final Set<String> ASPECTS = Set.of("ORIGINAL", "16:9", "9:16", "1:1", "4:3");
    private static final Set<String> DISPLAY_MODES = Set.of("SENTENCE", "PHRASE", "WORD");
    private static final Set<String> FONTS = Set.of("Arial", "DejaVu Sans");
    private static final Set<String> ALIGNMENTS = Set.of("left", "center", "right");

    private PresetJobDefaults() {
    }

    /** Render config seeded from the preset; {@code null} fields keep the job defaults. */
    static UpdateRenderConfigRequest renderConfig(PresetJobConfig preset) {
        JsonNode c = preset == null ? null : preset.renderConfig();
        if (c == null || !c.isObject()) {
            return empty();
        }
        Integer offset = null;
        if (c.path("verticalOffsetPercent").isInt()) {
            int value = c.get("verticalOffsetPercent").asInt();
            offset = value >= -30 && value <= 30 ? value : null;
        }
        return new UpdateRenderConfigRequest(
                oneOf(c, "subtitleMode", SUBTITLE_MODES),
                oneOf(c, "subtitlePosition", POSITIONS),
                offset,
                c.path("backgroundBox").isBoolean() ? c.get("backgroundBox").asBoolean() : null,
                matching(c, "backgroundColor", RGBA),
                matching(c, "textColor", RGB),
                oneOf(c, "outputAspectRatio", ASPECTS),
                subtitlePresentation(c.path("presentation").path("subtitle")));
    }

    /** Only the cue grouping is taken from a preset; cover layers/audio stay Render Studio edits. */
    private static RenderPresentation subtitlePresentation(JsonNode subtitle) {
        String displayMode = oneOf(subtitle, "displayMode", DISPLAY_MODES);
        if (displayMode == null) {
            return null;
        }
        Integer words = null;
        if ("PHRASE".equals(displayMode) && subtitle.path("wordsPerPhrase").isInt()) {
            int value = subtitle.get("wordsPerPhrase").asInt();
            words = value >= 3 && value <= 10 ? value : null;
        }
        return new RenderPresentation(new RenderPresentation.Subtitle(displayMode, words, null), null);
    }

    /** Full 13-field style snapshot, or {@code null} when the preset carries none / an invalid one. */
    static SubtitleStyleSnapshot subtitleStyle(PresetJobConfig preset) {
        JsonNode s = preset == null ? null : preset.subtitleStyle();
        if (s == null || !s.isObject() || !FONTS.contains(s.path("font_family").asText())
                || !s.path("font_size").isInt() || !ALIGNMENTS.contains(s.path("alignment").asText())
                || !RGB.matcher(s.path("primary_color").asText()).matches()
                || !RGB.matcher(s.path("outline_color").asText()).matches()) {
            return null;
        }
        int fontSize = s.get("font_size").asInt();
        int outlineWidth = s.path("outline_width").asInt(0);
        int opacity = s.path("opacity").asInt(100);
        String background = s.hasNonNull("background") ? s.get("background").asText() : null;
        if (fontSize < 16 || fontSize > 120 || outlineWidth < 0 || outlineWidth > 8
                || opacity < 0 || opacity > 100 || (background != null && !RGBA.matcher(background).matches())) {
            return null;
        }
        return new SubtitleStyleSnapshot(s.get("font_family").asText(), fontSize,
                s.get("primary_color").asText(), s.get("outline_color").asText(), outlineWidth,
                s.path("shadow").asBoolean(false), s.path("bold").asBoolean(false),
                s.path("italic").asBoolean(false), s.get("alignment").asText(),
                s.path("margin_v").asInt(0), s.path("line_spacing").asInt(0), background, opacity);
    }

    /** Frozen copy stored in {@code media_jobs.preset_snapshot}; later preset edits never reach the job. */
    static String snapshot(PresetJobConfig preset) {
        if (preset == null) {
            return "{}";
        }
        ObjectNode node = MAPPER.createObjectNode();
        node.put("presetId", preset.presetId().toString());
        node.put("name", preset.name());
        node.set("subtitleStyle", preset.subtitleStyle());
        node.set("voiceConfig", preset.voiceConfig());
        node.set("renderConfig", preset.renderConfig());
        return node.toString();
    }

    static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Cannot serialise preset defaults", ex);
        }
    }

    private static UpdateRenderConfigRequest empty() {
        return new UpdateRenderConfigRequest(null, null, null, null, null, null, null, null);
    }

    private static String oneOf(JsonNode node, String field, Set<String> allowed) {
        String value = node.path(field).asText(null);
        return value != null && allowed.contains(value) ? value : null;
    }

    private static String matching(JsonNode node, String field, Pattern pattern) {
        String value = node.path(field).asText(null);
        return value != null && pattern.matcher(value).matches() ? value : null;
    }
}
