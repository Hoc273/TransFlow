package com.app.modules.summarization.service;

import java.math.BigDecimal;
import java.util.List;

/**
 * Boundary to FastAPI (backend-ai) {@code summarize/script} (System_Architecture.md §7.2/§7.4). Real
 * implementation needs the backend-ai HTTP contract, which isn't specified in the docs available for this
 * module — {@code SummaryAiClientImpl} is a placeholder until that integration is built.
 */
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
            List<String> warnings
    ) {}
}
