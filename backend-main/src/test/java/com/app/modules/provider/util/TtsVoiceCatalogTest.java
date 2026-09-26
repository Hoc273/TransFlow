package com.app.modules.provider.util;

import com.app.modules.provider.client.AiGatewayClient.DiscoveredVoice;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.repository.TtsVoiceRepository;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TtsVoiceCatalogTest {

    private static TtsVoice voice(String voiceId, String language, List<String> languages,
                                  String displayName, String status) {
        TtsVoice v = new TtsVoice();
        v.setId(UUID.randomUUID());
        v.setVoiceId(voiceId);
        v.setLanguage(language);
        v.setLanguages(languages);
        v.setDisplayName(displayName);
        v.setStatus(status);
        return v;
    }

    @Test
    void nativeGaVoiceRanksBeforeMultilingualAndPreview() {
        // Azure API order put a PREVIEW Arabic multilingual voice first for every target language.
        TtsVoice arabicPreview = voice("ar-AE-Rashid:DragonHDLatestNeural", "ar-ae",
                List.of("ar", "vi", "en"), "Rashid Dragon HD Latest", "PREVIEW");
        TtsVoice germanMulti = voice("de-DE-SeraphinaMultilingualNeural", "de-de",
                List.of("de", "vi", "en"), "Seraphina Multilingual", "GA");
        TtsVoice namMinh = voice("vi-VN-NamMinhNeural", "vi-vn", List.of("vi"), "Nam Minh", "GA");
        TtsVoice hoaiMy = voice("vi-VN-HoaiMyNeural", "vi-vn", List.of("vi"), "Hoài My", "GA");
        TtsVoice viPreview = voice("vi-VN-Test:DragonHDLatestNeural", "vi-vn", List.of("vi"), "Test HD", "PREVIEW");

        List<String> ordered = new ArrayList<>(List.of(arabicPreview, germanMulti, viPreview, namMinh, hoaiMy))
                .stream()
                .sorted(TtsVoiceCatalog.ordering("vi", List.of()))
                .map(TtsVoice::getVoiceId)
                .toList();

        assertEquals(List.of(
                "vi-VN-HoaiMyNeural",
                "vi-VN-NamMinhNeural",
                "vi-VN-Test:DragonHDLatestNeural",
                "de-DE-SeraphinaMultilingualNeural",
                "ar-AE-Rashid:DragonHDLatestNeural"), ordered);
    }

    @Test
    void regionalVariantsCountAsNative() {
        TtsVoice gb = voice("en-GB-SoniaNeural", "en-gb", List.of("en"), "Sonia", "GA");
        TtsVoice multi = voice("fr-FR-VivienneMultilingualNeural", "fr-fr", List.of("fr", "en"), "Vivienne", "GA");

        List<TtsVoice> ordered = List.of(multi, gb).stream().sorted(TtsVoiceCatalog.ordering("en-US", List.of())).toList();

        assertEquals("en-GB-SoniaNeural", ordered.get(0).getVoiceId());
    }

    @Test
    void mainLocaleOfLanguageComesFirstNotAlphabeticalOne() {
        // Azure: en-AU sorted first alphabetically although en-US holds most English voices.
        TtsVoice au = voice("en-AU-AnnetteNeural", "en-au", List.of("en"), "Annette", "GA");
        TtsVoice us1 = voice("en-US-JennyNeural", "en-us", List.of("en"), "Jenny", "GA");
        TtsVoice us2 = voice("en-US-AvaNeural", "en-us", List.of("en"), "Ava", "GA");
        TtsVoice gb = voice("en-GB-SoniaNeural", "en-gb", List.of("en"), "Sonia", "GA");
        List<TtsVoice> pool = List.of(au, gb, us1, us2);

        assertEquals(List.of("en-US-AvaNeural", "en-US-JennyNeural", "en-AU-AnnetteNeural", "en-GB-SoniaNeural"),
                pool.stream().sorted(TtsVoiceCatalog.ordering("en", pool)).map(TtsVoice::getVoiceId).toList());
        // An explicit region wins over the biggest locale.
        assertEquals("en-GB-SoniaNeural",
                pool.stream().sorted(TtsVoiceCatalog.ordering("en-GB", pool)).findFirst().orElseThrow().getVoiceId());
    }

    @Test
    void synchronizeStoresDisplayNameStatusAndDeactivatesDeprecated() {
        TtsVoiceRepository repo = mock(TtsVoiceRepository.class);
        when(repo.save(any(TtsVoice.class))).thenAnswer(i -> i.getArgument(0));
        TtsVoice existingMia = voice("en-GB-MiaNeural", "en-gb", List.of("en"), null, null);
        existingMia.setActive(true);

        List<TtsVoice> active = TtsVoiceCatalog.synchronize(repo, List.of(existingMia), List.of(
                new DiscoveredVoice("vi-VN-HoaiMyNeural", "vi-VN", List.of("vi"), "FEMALE", "Hoài My", "GA"),
                new DiscoveredVoice("en-GB-MiaNeural", "en-GB", List.of("en"), "FEMALE", "Mia", "Deprecated"),
                new DiscoveredVoice("alloy", "en", List.of("en"), "UNKNOWN", "alloy", null)
        ), TtsVoice::new);

        assertEquals(List.of("vi-VN-HoaiMyNeural", "alloy"), active.stream().map(TtsVoice::getVoiceId).toList());
        assertEquals("Hoài My", active.get(0).getDisplayName());
        assertEquals("GA", active.get(0).getStatus());
        // A display name equal to the id carries no information.
        assertNull(active.get(1).getDisplayName());
        assertNull(active.get(1).getStatus());
        assertFalse(existingMia.isActive());
        assertEquals("DEPRECATED", existingMia.getStatus());
    }
}
