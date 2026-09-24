package com.app.modules.media_job.pipeline;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Pre-render subtitle check + grouping for the RENDER sidecar.
 * <ol>
 *   <li>{@link #sanitize}: the editor/QA rows may still hold blank text, cues past the video end or overlaps
 *       (QA only runs after TRANSLATE; later edits are not re-checked). Those are repaired here so the burned
 *       subtitles never show stacked or runaway cues.</li>
 *   <li>{@link #group}: {@code presentation.subtitle.displayMode} (API_Contract.md §5) — SENTENCE keeps the
 *       segment, PHRASE splits into {@code wordsPerPhrase} words, WORD into single words. Each chunk gets a
 *       share of the segment time proportional to its length.</li>
 * </ol>
 */
final class RenderSubtitleCues {

    static final int DEFAULT_WORDS_PER_PHRASE = 5;
    /** A cue shorter than this is unreadable; it is dropped by sanitize and never produced by group. */
    static final long MIN_CUE_MS = 200L;

    record Cue(long startMs, long endMs, String text) {
    }

    private RenderSubtitleCues() {
    }

    /** Normalised, in-bounds, non-overlapping cues in time order. */
    static List<Cue> sanitize(List<Cue> raw, long durationMs) {
        List<Cue> sorted = new ArrayList<>();
        for (Cue cue : raw) {
            String text = cleanText(cue.text());
            if (text.isEmpty()) {
                continue;
            }
            long start = Math.max(0L, cue.startMs());
            long end = durationMs > 0 ? Math.min(cue.endMs(), durationMs) : cue.endMs();
            sorted.add(new Cue(start, end, text));
        }
        sorted.sort((a, b) -> Long.compare(a.startMs(), b.startMs()));

        List<Cue> result = new ArrayList<>();
        for (Cue cue : sorted) {
            long start = cue.startMs();
            if (!result.isEmpty()) {
                Cue previous = result.get(result.size() - 1);
                if (start < previous.endMs()) {
                    // overlap: the earlier cue yields, unless that would make it unreadable
                    if (start - previous.startMs() >= MIN_CUE_MS) {
                        result.set(result.size() - 1, new Cue(previous.startMs(), start, previous.text()));
                    } else {
                        start = previous.endMs();
                    }
                }
            }
            if (cue.endMs() - start >= MIN_CUE_MS) {
                result.add(new Cue(start, cue.endMs(), cue.text()));
            }
        }
        return result;
    }

    /**
     * Map source-timeline cues onto the concatenated output of {@code cutRanges}
     * ({@code [startMs, endMs]} in source time, in render order). Parts of a cue
     * outside every cut are dropped; a cue continuing across adjacent cuts stays
     * one cue on the output timeline.
     */
    static List<Cue> toOutputTimeline(List<Cue> cues, List<long[]> cutRanges) {
        List<Cue> result = new ArrayList<>();
        for (Cue cue : cues) {
            long offset = 0L;
            for (long[] range : cutRanges) {
                long start = Math.max(cue.startMs(), range[0]);
                long end = Math.min(cue.endMs(), range[1]);
                if (end > start) {
                    Cue mapped = new Cue(offset + start - range[0], offset + end - range[0], cue.text());
                    Cue previous = result.isEmpty() ? null : result.get(result.size() - 1);
                    if (previous != null && previous.text().equals(mapped.text())
                            && previous.endMs() == mapped.startMs()) {
                        result.set(result.size() - 1, new Cue(previous.startMs(), mapped.endMs(), mapped.text()));
                    } else {
                        result.add(mapped);
                    }
                }
                offset += Math.max(0L, range[1] - range[0]);
            }
        }
        return result;
    }

    static List<Cue> group(List<Cue> cues, String displayMode, Integer wordsPerPhrase) {
        String mode = displayMode == null ? "SENTENCE" : displayMode.toUpperCase(Locale.ROOT);
        int size = switch (mode) {
            case "WORD" -> 1;
            case "PHRASE" -> wordsPerPhrase == null ? DEFAULT_WORDS_PER_PHRASE : Math.max(1, wordsPerPhrase);
            default -> 0;
        };
        if (size == 0) {
            return cues;
        }
        List<Cue> result = new ArrayList<>();
        for (Cue cue : cues) {
            result.addAll(split(cue, size));
        }
        return result;
    }

    private static List<Cue> split(Cue cue, int wordsPerChunk) {
        String[] words = cue.text().split(" ");
        long duration = cue.endMs() - cue.startMs();
        // Scripts without spaces (zh/ja/th) stay whole; a chunk must also stay readable.
        int maxChunks = (int) Math.max(1L, duration / MIN_CUE_MS);
        int chunkCount = Math.min((words.length + wordsPerChunk - 1) / wordsPerChunk, maxChunks);
        if (chunkCount <= 1) {
            return List.of(cue);
        }
        int perChunk = (words.length + chunkCount - 1) / chunkCount;
        List<String> chunks = new ArrayList<>();
        for (int i = 0; i < words.length; i += perChunk) {
            chunks.add(String.join(" ", java.util.Arrays.copyOfRange(words, i, Math.min(words.length, i + perChunk))));
        }
        long totalChars = chunks.stream().mapToLong(String::length).sum();
        List<Cue> result = new ArrayList<>();
        long start = cue.startMs();
        long consumed = 0;
        for (int i = 0; i < chunks.size(); i++) {
            consumed += chunks.get(i).length();
            long end = i == chunks.size() - 1
                    ? cue.endMs()
                    : cue.startMs() + Math.round((double) duration * consumed / totalChars);
            result.add(new Cue(start, end, chunks.get(i)));
            start = end;
        }
        return result;
    }

    /** One line, single spaces, and no {@code -->} (it would end the SRT timing line early). */
    private static String cleanText(String text) {
        if (text == null) {
            return "";
        }
        return text.replace("-->", "->").replaceAll("\\s+", " ").trim();
    }
}
