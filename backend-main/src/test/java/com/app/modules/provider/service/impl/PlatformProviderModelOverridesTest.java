package com.app.modules.provider.service.impl;

import com.app.common.exception.AppException;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.service.ProviderResolverService;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlatformProviderModelOverridesTest {

    @Test
    void normalizesOperationKeysAndDropsBlankModels() {
        Map<String, String> raw = new HashMap<>();
        raw.put(" summarize_script ", " auto:script ");
        raw.put("qa", "");
        raw.put("REFINE", null);

        assertEquals(Map.of("SUMMARIZE_SCRIPT", "auto:script"),
                PlatformProviderServiceImpl.modelOverrides(raw, provider("TRANSLATE")));
    }

    @Test
    void rejectsUnknownOperation() {
        assertThrows(AppException.class, () -> PlatformProviderServiceImpl.modelOverrides(
                Map.of("TRANSLATE", "auto:other"), provider("TRANSLATE")));
    }

    @Test
    void rejectsOverridesOnKeyWithoutTranslate() {
        assertThrows(AppException.class, () -> PlatformProviderServiceImpl.modelOverrides(
                Map.of("QA", "auto:script"), provider("VISION")));
        assertTrue(PlatformProviderServiceImpl.modelOverrides(Map.of("QA", " "), provider("VISION")).isEmpty());
    }

    @Test
    void resolutionFallsBackToDefaultModelWithoutOverride() {
        var resolution = new ProviderResolverService.ProviderResolution(UUID.randomUUID(), "openai_compatible",
                "http://freellmapi:3001/v1", "key", "auto:translate", false, Map.of("QA", "auto:script"));

        assertEquals("auto:script", resolution.modelFor("QA"));
        assertEquals("auto:translate", resolution.modelFor("SUMMARIZE_SCRIPT"));
        assertEquals("auto:translate", resolution.modelFor(null));
    }

    private static PlatformAiProvider provider(String capability) {
        PlatformAiProvider provider = new PlatformAiProvider();
        provider.setCapabilities(List.of(capability));
        return provider;
    }
}
