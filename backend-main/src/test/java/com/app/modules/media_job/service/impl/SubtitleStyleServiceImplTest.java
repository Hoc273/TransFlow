package com.app.modules.media_job.service.impl;

import com.app.modules.media_job.dto.style.SubtitleStylePreset;
import com.app.modules.media_job.dto.style.SubtitleStyleSnapshot;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/** Guards the built-in catalog (subtitle-styles.json) against out-of-range / malformed values. */
class SubtitleStyleServiceImplTest {

    private static final Pattern RGB = Pattern.compile("^#[0-9A-Fa-f]{6}$");
    private static final Pattern RGBA = Pattern.compile("^#[0-9A-Fa-f]{8}$");

    @Test
    void catalog_isValid() {
        List<SubtitleStylePreset> catalog = new SubtitleStyleServiceImpl(null, null, null, null, new ObjectMapper())
                .listPresets();

        assertEquals(5, catalog.size());
        assertEquals(catalog.size(), new HashSet<>(catalog.stream().map(SubtitleStylePreset::key).toList()).size());
        for (SubtitleStylePreset p : catalog) {
            SubtitleStyleSnapshot s = p.snapshot();
            assertTrue(p.key().matches("^[a-z0-9][a-z0-9-]{0,63}$"), p.key());
            assertTrue(List.of("Arial", "DejaVu Sans").contains(s.fontFamily()), p.key());
            assertTrue(s.fontSize() >= 16 && s.fontSize() <= 120, p.key());
            assertTrue(RGB.matcher(s.primaryColor()).matches() && RGB.matcher(s.outlineColor()).matches(), p.key());
            assertTrue(s.outlineWidth() >= 0 && s.outlineWidth() <= 8, p.key());
            assertTrue(List.of("left", "center", "right").contains(s.alignment()), p.key());
            assertTrue(s.background() == null || RGBA.matcher(s.background()).matches(), p.key());
            assertTrue(s.opacity() >= 0 && s.opacity() <= 100, p.key());
        }
    }
}
