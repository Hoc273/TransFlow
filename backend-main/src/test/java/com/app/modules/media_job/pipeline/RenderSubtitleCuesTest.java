package com.app.modules.media_job.pipeline;

import com.app.modules.media_job.pipeline.RenderSubtitleCues.Cue;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RenderSubtitleCuesTest {

    @Test
    void sanitize_dropsBlankAndOutOfRange_clampsToDuration_andCleansText() {
        List<Cue> cues = RenderSubtitleCues.sanitize(List.of(
                new Cue(0, 1_000, "  xin\n chào  "),
                new Cue(1_000, 2_000, "   "),
                new Cue(9_000, 12_000, "a --> b"),
                new Cue(12_000, 13_000, "after the end")), 10_000);

        assertEquals(List.of(new Cue(0, 1_000, "xin chào"), new Cue(9_000, 10_000, "a -> b")), cues);
    }

    @Test
    void sanitize_trimsOverlaps_andSortsByStart() {
        List<Cue> cues = RenderSubtitleCues.sanitize(List.of(
                new Cue(1_500, 3_000, "second"),
                new Cue(0, 2_000, "first"),
                new Cue(1_550, 3_500, "third")), 10_000);

        // first yields to second; third starts inside second's first 200 ms, so it is pushed after second.
        assertEquals(List.of(new Cue(0, 1_500, "first"), new Cue(1_500, 3_000, "second"),
                new Cue(3_000, 3_500, "third")), cues);
    }

    @Test
    void group_phrase_splitsIntoBalancedChunksOfAtMostFiveWords_withProportionalTiming() {
        List<Cue> cues = RenderSubtitleCues.group(List.of(
                new Cue(0, 6_000, "one two three four five six seven eight nine ten eleven twelve")), "PHRASE", null);

        // 12 words -> 3 chunks of 4 (no dangling 2-word tail)
        assertEquals(3, cues.size());
        assertEquals("one two three four", cues.get(0).text());
        assertEquals("nine ten eleven twelve", cues.get(2).text());
        assertEquals(0, cues.get(0).startMs());
        assertEquals(6_000, cues.get(2).endMs());
        for (int i = 1; i < cues.size(); i++) {
            assertEquals(cues.get(i - 1).endMs(), cues.get(i).startMs());
        }
    }

    @Test
    void group_sentenceKeepsSegments_andShortCueIsNotSplitBelowReadableLength() {
        List<Cue> sentence = List.of(new Cue(0, 4_000, "a b c d e f g"));
        assertEquals(sentence, RenderSubtitleCues.group(sentence, "SENTENCE", 5));
        assertEquals(sentence, RenderSubtitleCues.group(sentence, null, null));

        List<Cue> words = RenderSubtitleCues.group(List.of(new Cue(0, 500, "a b c d e f")), "WORD", null);
        assertTrue(words.size() <= 2);
        assertEquals(500, words.get(words.size() - 1).endMs());
    }
}
