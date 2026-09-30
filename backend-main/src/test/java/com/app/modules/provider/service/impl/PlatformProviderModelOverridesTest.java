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
                Map.of("EMBEDDING", "auto:other"), provider("TRANSLATE")));
    }

    @Test
    void acceptsCapabilityModelsOnlyForCapabilitiesTheKeyHas() {
        PlatformAiProvider openAi = provider("TRANSLATE", "STT", "TTS");
        assertEquals(Map.of("STT", "whisper-1", "TTS", "tts-1"), PlatformProviderServiceImpl.modelOverrides(
                Map.of("stt", " whisper-1 ", "TTS", "tts-1"), openAi));
        assertThrows(AppException.class, () -> PlatformProviderServiceImpl.modelOverrides(
                Map.of("VISION", "gpt-4o-mini"), openAi));
    }

    @Test
    void keyRunsEachCapabilityWithItsOwnModel() {
        PlatformAiProvider openAi = provider("TRANSLATE", "STT", "TTS");
        openAi.setDefaultModel("gpt-4o-mini");
        openAi.setModelOverrides(new java.util.LinkedHashMap<>(Map.of("STT", "whisper-1", "TTS", "tts-1")));

        assertEquals("whisper-1", openAi.modelFor("stt"));
        assertEquals("tts-1", openAi.modelFor("TTS"));
        assertEquals("gpt-4o-mini", openAi.modelFor("TRANSLATE"));
        assertEquals("gpt-4o-mini", openAi.modelFor(null));
    }

    @Test
    void capabilityChangeDropsOverridesTheKeyCanNoLongerUse() {
        PlatformAiProvider key = provider("STT", "TTS");
        key.setModelOverrides(new java.util.LinkedHashMap<>(Map.of("STT", "whisper-1", "TTS", "tts-1", "QA", "x")));

        assertEquals(Map.of("STT", "whisper-1", "TTS", "tts-1"), PlatformProviderServiceImpl.applicableOverrides(key));
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

    private static PlatformAiProvider provider(String... capabilities) {
        PlatformAiProvider provider = new PlatformAiProvider();
        provider.setCapabilities(List.of(capabilities));
        return provider;
    }
}
