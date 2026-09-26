package com.app.modules.provider.util;

import com.app.modules.provider.client.AiGatewayClient.DiscoveredVoice;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.repository.TtsVoiceRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * Shared voice-catalog rules for BYOK refresh and platform sync.
 *
 * <p>Catalogs can hold hundreds of voices per language (Azure: 780 voices, 348 usable for
 * {@code en}), so rows are upserted by vendor {@code voice_id} and never deleted — a media job
 * may still reference them (ON DELETE SET NULL would break {@code ck_audio_mode_voice}).
 */
public final class TtsVoiceCatalog {

    private TtsVoiceCatalog() {
    }

    /**
     * Upserts {@code discovered} over {@code existingRows}. Voices the provider dropped or marked
     * DEPRECATED become inactive. Returns the rows that are active after the sync.
     */
    public static List<TtsVoice> synchronize(TtsVoiceRepository repository,
                                             List<TtsVoice> existingRows,
                                             List<DiscoveredVoice> discovered,
                                             Supplier<TtsVoice> newRow) {
        Map<String, TtsVoice> existing = new HashMap<>();
        for (TtsVoice voice : existingRows) {
            existing.put(voice.getVoiceId(), voice);
        }
        Instant now = Instant.now();
        List<TtsVoice> active = new ArrayList<>();
        for (DiscoveredVoice d : discovered) {
            if (d.voiceId() == null || d.voiceId().isBlank()) {
                continue;
            }
            TtsVoice voice = existing.remove(d.voiceId());
            if (voice == null) {
                voice = newRow.get();
                voice.setVoiceId(d.voiceId());
            }
            String language = d.language() != null ? d.language().toLowerCase(Locale.ROOT) : "en";
            voice.setLanguage(language);
            voice.setLanguages(d.languages() != null && !d.languages().isEmpty()
                    ? d.languages().stream().map(l -> l.toLowerCase(Locale.ROOT)).toList()
                    : List.of(language));
            voice.setGender(d.gender() != null ? d.gender().toUpperCase(Locale.ROOT) : "UNKNOWN");
            voice.setDisplayName(d.displayName() != null && !d.displayName().isBlank()
                    && !d.displayName().equals(d.voiceId()) ? d.displayName().trim() : null);
            String status = normalizeStatus(d.status());
            voice.setStatus(status);
            voice.setActive(!"DEPRECATED".equals(status));
            voice.setCachedAt(now);
            TtsVoice saved = repository.save(voice);
            if (saved.isActive()) {
                active.add(saved);
            }
        }
        for (TtsVoice gone : existing.values()) {
            if (gone.isActive()) {
                gone.setActive(false);
                repository.save(gone);
            }
        }
        return active;
    }

    /**
     * Picker order for a target language: voices native to it first (a Vietnamese voice before a
     * multilingual English one), GA before PREVIEW, then the language's main locale — the exact
     * target region when one is given ("en-GB"), else the locale with the most voices in
     * {@code pool} (en-US over en-AU, fr-FR over fr-BE) — then locale and name. The first entry
     * is the UI's default pick. With no target, only lifecycle, locale and name apply.
     */
    public static Comparator<TtsVoice> ordering(String targetLang, Collection<TtsVoice> pool) {
        String exactLocale = targetLang != null && targetLang.contains("-")
                ? targetLang.trim().toLowerCase(Locale.ROOT).replace('_', '-') : null;
        Map<String, Long> localeSizes = pool.stream()
                .collect(Collectors.groupingBy(TtsVoiceCatalog::locale, Collectors.counting()));
        return Comparator.<TtsVoice>comparingInt(v -> targetLang != null && v.isNativeFor(targetLang) ? 0 : 1)
                .thenComparingInt(TtsVoiceCatalog::statusRank)
                .thenComparingInt(v -> locale(v).equals(exactLocale) ? 0 : 1)
                .thenComparing(v -> -localeSizes.getOrDefault(locale(v), 0L))
                .thenComparing(TtsVoiceCatalog::locale)
                .thenComparing(TtsVoiceCatalog::label, String.CASE_INSENSITIVE_ORDER);
    }

    private static String locale(TtsVoice voice) {
        return nullToEmpty(voice.getLanguage()).toLowerCase(Locale.ROOT).replace('_', '-');
    }

    private static int statusRank(TtsVoice voice) {
        String status = voice.getStatus();
        if (status == null || "GA".equals(status)) {
            return 0;
        }
        return "PREVIEW".equals(status) ? 1 : 2;
    }

    private static String label(TtsVoice voice) {
        String name = voice.getDisplayName();
        return name != null && !name.isBlank() ? name : nullToEmpty(voice.getVoiceId());
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static String normalizeStatus(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String status = raw.trim().toUpperCase(Locale.ROOT);
        return switch (status) {
            case "GA", "PREVIEW", "DEPRECATED" -> status;
            default -> null;
        };
    }
}
