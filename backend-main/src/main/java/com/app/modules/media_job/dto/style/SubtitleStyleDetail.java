package com.app.modules.media_job.dto.style;

import com.fasterxml.jackson.annotation.JsonUnwrapped;

/** {@code GET /api/media/subtitle-styles/{key}}: key/name/revision + the 13 snapshot fields on the same level. */
public record SubtitleStyleDetail(String key, String name, int revision, @JsonUnwrapped SubtitleStyleSnapshot snapshot) {

    public static SubtitleStyleDetail from(SubtitleStylePreset p) {
        return new SubtitleStyleDetail(p.key(), p.name(), p.revision(), p.snapshot());
    }
}
