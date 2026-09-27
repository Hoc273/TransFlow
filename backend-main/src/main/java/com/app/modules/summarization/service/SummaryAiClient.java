package com.app.modules.summarization.service;

import java.math.BigDecimal;
import java.util.List;

/** Boundary to FastAPI (backend-ai) script-first summarization endpoints. */
public interface SummaryAiClient {

    ScriptProposalResult generateScript(String transcript, String visualContext, int requestedDurationSeconds, String targetLang);

    ScriptProposalResult refineScript(String previousScript, String feedbackText, String targetLang);

    record SegmentDraft(
            long startMs,
            long endMs,
            String scriptExcerpt,
            List<String> sourceSentenceRefs,
            String reasoningNote
    ) {}

    record ScriptProposalResult(
            String scriptContent,
            String scriptLanguage,
            List<SegmentDraft> segments,
            String reasoningNote,
            BigDecimal confidence,
            List<String> warnings,
            long inputTokens,
            long outputTokens
    ) {
        /** Backward-compatible constructor for local/fake clients that do not expose usage yet. */
        public ScriptProposalResult(String scriptContent,
                                     String scriptLanguage,
                                     List<SegmentDraft> segments,
                                     String reasoningNote,
                                     BigDecimal confidence,
                                     List<String> warnings) {
            this(scriptContent, scriptLanguage, segments, reasoningNote, confidence, warnings, 0L, 0L);
        }

        public long usageTokens() {
            return Math.max(0L, inputTokens) + Math.max(0L, outputTokens);
        }

        /** Duration represented by the matched footage segments. */
        public long totalDurationMs() {
            if (segments == null) {
                return 0L;
            }
            return segments.stream()
                    .mapToLong(segment -> Math.max(0L, segment.endMs() - segment.startMs()))
                    .sum();
        }

        /** Alias matching the FastAPI/domain terminology. */
        public BigDecimal confidenceScore() {
            return confidence;
        }
    }
}
